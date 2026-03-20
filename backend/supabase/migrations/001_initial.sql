-- ============================================================
-- CallGlobe Database Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  phone text,
  balance numeric(10,4) default 2.5000,  -- Welcome credit $2.50
  total_recharged numeric(10,2) default 0,
  total_spent numeric(10,4) default 0,
  currency text default 'USD',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS policies
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- CALL RATES (per-minute rates by country)
-- ============================================================
create table public.call_rates (
  id uuid default uuid_generate_v4() primary key,
  country_code text not null,       -- ISO 2-letter
  country_name text not null,
  dial_code text not null,           -- e.g. +91
  flag text,                         -- emoji flag
  rate_per_min numeric(6,4) not null, -- USD cost to USER
  cost_per_min numeric(6,4) not null, -- USD cost to US (Telnyx)
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table public.call_rates enable row level security;

create policy "Anyone can read call rates"
  on public.call_rates for select
  using (true);

-- Insert default rates (your sell price, adjust as needed)
insert into public.call_rates (country_code, country_name, dial_code, flag, rate_per_min, cost_per_min) values
  ('US', 'United States', '+1', '🇺🇸', 0.0200, 0.0060),
  ('GB', 'United Kingdom', '+44', '🇬🇧', 0.0250, 0.0080),
  ('SA', 'Saudi Arabia', '+966', '🇸🇦', 0.0400, 0.0150),
  ('IN', 'India', '+91', '🇮🇳', 0.0150, 0.0040),
  ('PK', 'Pakistan', '+92', '🇵🇰', 0.0400, 0.0150),
  ('PH', 'Philippines', '+63', '🇵🇭', 0.0350, 0.0120),
  ('BD', 'Bangladesh', '+880', '🇧🇩', 0.0400, 0.0140),
  ('EG', 'Egypt', '+20', '🇪🇬', 0.0450, 0.0180),
  ('AE', 'UAE', '+971', '🇦🇪', 0.0300, 0.0100),
  ('DE', 'Germany', '+49', '🇩🇪', 0.0200, 0.0060),
  ('FR', 'France', '+33', '🇫🇷', 0.0200, 0.0060),
  ('CN', 'China', '+86', '🇨🇳', 0.0250, 0.0080),
  ('JP', 'Japan', '+81', '🇯🇵', 0.0350, 0.0120),
  ('NG', 'Nigeria', '+234', '🇳🇬', 0.0600, 0.0250),
  ('KE', 'Kenya', '+254', '🇰🇪', 0.0500, 0.0200),
  ('BR', 'Brazil', '+55', '🇧🇷', 0.0400, 0.0150),
  ('MX', 'Mexico', '+52', '🇲🇽', 0.0350, 0.0120),
  ('TR', 'Turkey', '+90', '🇹🇷', 0.0450, 0.0180),
  ('ID', 'Indonesia', '+62', '🇮🇩', 0.0400, 0.0150),
  ('TH', 'Thailand', '+66', '🇹🇭', 0.0350, 0.0120),
  ('NP', 'Nepal', '+977', '🇳🇵', 0.0550, 0.0220),
  ('LK', 'Sri Lanka', '+94', '🇱🇰', 0.0500, 0.0200),
  ('ET', 'Ethiopia', '+251', '🇪🇹', 0.0700, 0.0300),
  ('GH', 'Ghana', '+233', '🇬🇭', 0.0550, 0.0220),
  ('CA', 'Canada', '+1', '🇨🇦', 0.0200, 0.0060),
  ('AU', 'Australia', '+61', '🇦🇺', 0.0250, 0.0080),
  ('KR', 'South Korea', '+82', '🇰🇷', 0.0250, 0.0080),
  ('JO', 'Jordan', '+962', '🇯🇴', 0.0450, 0.0180),
  ('LB', 'Lebanon', '+961', '🇱🇧', 0.0550, 0.0220),
  ('IQ', 'Iraq', '+964', '🇮🇶', 0.0700, 0.0300);

-- ============================================================
-- RECHARGE PACKAGES
-- ============================================================
create table public.recharge_packages (
  id uuid default uuid_generate_v4() primary key,
  amount numeric(8,2) not null,        -- USD price charged
  credit numeric(8,2) not null,        -- USD credit given (amount + bonus)
  bonus_percent integer default 0,
  label text not null,
  is_active boolean default true,
  stripe_price_id text,                -- Stripe Price object ID
  sort_order integer default 0,
  created_at timestamptz default now()
);

alter table public.recharge_packages enable row level security;

create policy "Anyone can read packages"
  on public.recharge_packages for select
  using (is_active = true);

insert into public.recharge_packages (amount, credit, bonus_percent, label, sort_order) values
  (10.00, 10.00, 0, '$10', 1),
  (20.00, 21.00, 5, '$20', 2),
  (30.00, 33.00, 10, '$30', 3),
  (50.00, 60.00, 20, '$50', 4),
  (100.00, 130.00, 30, '$100', 5);

-- ============================================================
-- TRANSACTIONS (recharges + call deductions)
-- ============================================================
create table public.transactions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check (type in ('recharge', 'call_deduction', 'refund', 'welcome_credit')),
  amount numeric(10,4) not null,       -- positive for recharge, negative for deduction
  balance_after numeric(10,4) not null,
  description text,
  metadata jsonb default '{}',         -- stripe session ID, call ID, etc.
  created_at timestamptz default now()
);

alter table public.transactions enable row level security;

create policy "Users can view own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

-- ============================================================
-- CALL LOGS (CDR - Call Detail Records)
-- ============================================================
create table public.call_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  telnyx_call_id text,                  -- Telnyx call control ID
  destination_number text not null,
  destination_country text,
  destination_country_code text,
  rate_per_min numeric(6,4),
  duration_seconds integer default 0,
  billable_seconds integer default 0,   -- rounded up to nearest 60
  total_cost numeric(10,4) default 0,
  status text default 'initiated' check (status in ('initiated', 'ringing', 'connected', 'completed', 'failed', 'no_answer', 'busy')),
  started_at timestamptz default now(),
  connected_at timestamptz,
  ended_at timestamptz,
  metadata jsonb default '{}'
);

alter table public.call_logs enable row level security;

create policy "Users can view own call logs"
  on public.call_logs for select
  using (auth.uid() = user_id);

create index idx_call_logs_user on public.call_logs(user_id, started_at desc);
create index idx_call_logs_telnyx on public.call_logs(telnyx_call_id);

-- ============================================================
-- BALANCE OPERATIONS (atomic, safe)
-- ============================================================

-- Add balance (used by Stripe webhook after successful payment)
create or replace function public.add_balance(
  p_user_id uuid,
  p_amount numeric,
  p_description text default 'Recharge',
  p_metadata jsonb default '{}'
)
returns numeric as $$
declare
  new_balance numeric;
begin
  update public.profiles
  set balance = balance + p_amount,
      total_recharged = total_recharged + p_amount,
      updated_at = now()
  where id = p_user_id
  returning balance into new_balance;

  insert into public.transactions (user_id, type, amount, balance_after, description, metadata)
  values (p_user_id, 'recharge', p_amount, new_balance, p_description, p_metadata);

  return new_balance;
end;
$$ language plpgsql security definer;

-- Deduct balance (used during/after calls)
create or replace function public.deduct_balance(
  p_user_id uuid,
  p_amount numeric,
  p_call_log_id uuid default null,
  p_description text default 'Call charge'
)
returns jsonb as $$
declare
  current_bal numeric;
  new_balance numeric;
begin
  -- Get current balance with row lock
  select balance into current_bal
  from public.profiles
  where id = p_user_id
  for update;

  if current_bal < p_amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient balance', 'balance', current_bal);
  end if;

  update public.profiles
  set balance = balance - p_amount,
      total_spent = total_spent + p_amount,
      updated_at = now()
  where id = p_user_id
  returning balance into new_balance;

  insert into public.transactions (user_id, type, amount, balance_after, description, metadata)
  values (p_user_id, 'call_deduction', -p_amount, new_balance, p_description,
    case when p_call_log_id is not null
      then jsonb_build_object('call_log_id', p_call_log_id)
      else '{}'
    end
  );

  return jsonb_build_object('success', true, 'balance', new_balance);
end;
$$ language plpgsql security definer;

-- Get balance (quick check)
create or replace function public.get_user_balance(p_user_id uuid)
returns numeric as $$
  select balance from public.profiles where id = p_user_id;
$$ language sql security definer;

-- ============================================================
-- REFERRAL SYSTEM
-- ============================================================
-- Add referral fields to profiles
alter table public.profiles add column if not exists referral_code text unique;
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id);
alter table public.profiles add column if not exists referral_count integer default 0;
alter table public.profiles add column if not exists referral_earnings numeric(10,4) default 0;

-- Generate unique referral code on signup
create or replace function public.generate_referral_code()
returns trigger as $$
begin
  new.referral_code := 'CG-' || upper(substring(md5(random()::text) from 1 for 6));
  return new;
end;
$$ language plpgsql;

create trigger set_referral_code
  before insert on public.profiles
  for each row
  when (new.referral_code is null)
  execute procedure public.generate_referral_code();

-- Referrals tracking table
create table public.referrals (
  id uuid default uuid_generate_v4() primary key,
  referrer_id uuid references public.profiles(id) on delete cascade not null,
  referred_id uuid references public.profiles(id) on delete cascade not null,
  status text default 'signed_up' check (status in ('signed_up', 'recharged', 'credited')),
  referrer_credit numeric(6,2) default 0,
  referred_credit numeric(6,2) default 0,
  created_at timestamptz default now(),
  credited_at timestamptz
);

alter table public.referrals enable row level security;

create policy "Users can view own referrals"
  on public.referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

create index idx_referrals_referrer on public.referrals(referrer_id);

-- Process referral bonus (called after first recharge by referred user)
create or replace function public.process_referral_bonus(p_referred_id uuid)
returns jsonb as $$
declare
  v_referrer_id uuid;
  v_referral_id uuid;
  bonus_amount numeric := 2.00;  -- $2 each
begin
  -- Find the referral record that hasn't been credited yet
  select r.id, r.referrer_id into v_referral_id, v_referrer_id
  from public.referrals r
  where r.referred_id = p_referred_id
    and r.status = 'recharged'
  limit 1;

  if v_referral_id is null then
    return jsonb_build_object('success', false, 'error', 'No eligible referral found');
  end if;

  -- Credit the referrer
  perform public.add_balance(v_referrer_id, bonus_amount, 'Referral bonus', jsonb_build_object('referral_id', v_referral_id));

  -- Credit the referred user
  perform public.add_balance(p_referred_id, bonus_amount, 'Welcome referral bonus', jsonb_build_object('referral_id', v_referral_id));

  -- Update referral status
  update public.referrals
  set status = 'credited', referrer_credit = bonus_amount, referred_credit = bonus_amount, credited_at = now()
  where id = v_referral_id;

  -- Update referrer stats
  update public.profiles
  set referral_count = referral_count + 1,
      referral_earnings = referral_earnings + bonus_amount
  where id = v_referrer_id;

  return jsonb_build_object('success', true, 'referrer_credited', bonus_amount, 'referred_credited', bonus_amount);
end;
$$ language plpgsql security definer;
