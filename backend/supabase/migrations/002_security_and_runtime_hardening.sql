-- ============================================================
-- CallGlobe Security and Runtime Hardening
-- Apply after 001_initial.sql
-- ============================================================

-- Rename the provider call SID column to match the Twilio-based stack.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'call_logs'
      and column_name = 'telnyx_call_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'call_logs'
      and column_name = 'provider_call_id'
  ) then
    alter table public.call_logs rename column telnyx_call_id to provider_call_id;
  end if;
end $$;

alter table public.call_logs
  add column if not exists charged_at timestamptz,
  add column if not exists billing_error text;

drop index if exists public.idx_call_logs_telnyx;
create unique index if not exists idx_call_logs_provider_call
  on public.call_logs(provider_call_id)
  where provider_call_id is not null;

create table if not exists public.processed_stripe_checkouts (
  stripe_session_id text primary key,
  stripe_event_id text,
  user_id uuid references public.profiles(id) on delete cascade not null,
  package_id uuid references public.recharge_packages(id) on delete set null,
  credit_amount numeric(10,4) not null,
  payment_amount numeric(10,2) not null default 0,
  stripe_payment_intent text,
  processed_at timestamptz default now()
);

alter table public.processed_stripe_checkouts enable row level security;

create or replace function public.add_balance(
  p_user_id uuid,
  p_amount numeric,
  p_description text default 'Recharge',
  p_metadata jsonb default '{}'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  update public.profiles
  set balance = balance + p_amount,
      total_recharged = total_recharged + p_amount,
      updated_at = now()
  where id = p_user_id
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Profile not found for user %', p_user_id;
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description, metadata)
  values (p_user_id, 'recharge', p_amount, new_balance, p_description, coalesce(p_metadata, '{}'::jsonb));

  return new_balance;
end;
$$;

create or replace function public.deduct_balance(
  p_user_id uuid,
  p_amount numeric,
  p_call_log_id uuid default null,
  p_description text default 'Call charge'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_bal numeric;
  new_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  select balance into current_bal
  from public.profiles
  where id = p_user_id
  for update;

  if current_bal is null then
    raise exception 'Profile not found for user %', p_user_id;
  end if;

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
  values (
    p_user_id,
    'call_deduction',
    -p_amount,
    new_balance,
    p_description,
    case
      when p_call_log_id is not null then jsonb_build_object('call_log_id', p_call_log_id)
      else '{}'::jsonb
    end
  );

  return jsonb_build_object('success', true, 'balance', new_balance);
end;
$$;

create or replace function public.get_user_balance(p_user_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select balance from public.profiles where id = p_user_id;
$$;

create or replace function public.process_referral_bonus(p_referred_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_referral_id uuid;
  bonus_amount numeric := 2.00;
begin
  select r.id, r.referrer_id into v_referral_id, v_referrer_id
  from public.referrals r
  where r.referred_id = p_referred_id
    and r.status = 'recharged'
  limit 1;

  if v_referral_id is null then
    return jsonb_build_object('success', false, 'error', 'No eligible referral found');
  end if;

  perform public.add_balance(v_referrer_id, bonus_amount, 'Referral bonus', jsonb_build_object('referral_id', v_referral_id));
  perform public.add_balance(p_referred_id, bonus_amount, 'Welcome referral bonus', jsonb_build_object('referral_id', v_referral_id));

  update public.referrals
  set status = 'credited',
      referrer_credit = bonus_amount,
      referred_credit = bonus_amount,
      credited_at = now()
  where id = v_referral_id;

  update public.profiles
  set referral_count = referral_count + 1,
      referral_earnings = referral_earnings + bonus_amount
  where id = v_referrer_id;

  return jsonb_build_object('success', true, 'referrer_credited', bonus_amount, 'referred_credited', bonus_amount);
end;
$$;

create or replace function public.process_stripe_checkout(
  p_stripe_session_id text,
  p_user_id uuid,
  p_credit_amount numeric,
  p_payment_amount numeric,
  p_package_id uuid default null,
  p_payment_intent text default null,
  p_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_rows integer;
  new_balance numeric;
begin
  if coalesce(trim(p_stripe_session_id), '') = '' then
    raise exception 'Stripe session id is required';
  end if;

  if p_credit_amount is null or p_credit_amount <= 0 then
    raise exception 'Credit amount must be greater than zero';
  end if;

  insert into public.processed_stripe_checkouts (
    stripe_session_id,
    stripe_event_id,
    user_id,
    package_id,
    credit_amount,
    payment_amount,
    stripe_payment_intent
  )
  values (
    p_stripe_session_id,
    p_event_id,
    p_user_id,
    p_package_id,
    p_credit_amount,
    coalesce(p_payment_amount, 0),
    p_payment_intent
  )
  on conflict (stripe_session_id) do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows = 0 then
    select balance into new_balance
    from public.profiles
    where id = p_user_id;

    return jsonb_build_object(
      'processed', false,
      'duplicate', true,
      'balance', new_balance
    );
  end if;

  new_balance := public.add_balance(
    p_user_id,
    p_credit_amount,
    format('Recharge - $%s payment', to_char(coalesce(p_payment_amount, 0), 'FM999999990.00')),
    jsonb_build_object(
      'stripe_session_id', p_stripe_session_id,
      'stripe_payment_intent', p_payment_intent,
      'package_id', p_package_id,
      'stripe_event_id', p_event_id
    )
  );

  return jsonb_build_object(
    'processed', true,
    'duplicate', false,
    'balance', new_balance
  );
end;
$$;

create or replace function public.process_completed_call(
  p_provider_call_id text,
  p_duration_seconds integer,
  p_ended_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call_log public.call_logs%rowtype;
  v_duration_seconds integer := greatest(coalesce(p_duration_seconds, 0), 0);
  v_billable_seconds integer := 0;
  v_total_cost numeric(10,4) := 0;
  v_charge_result jsonb := jsonb_build_object('success', true);
begin
  if coalesce(trim(p_provider_call_id), '') = '' then
    raise exception 'Provider call id is required';
  end if;

  select *
  into v_call_log
  from public.call_logs
  where provider_call_id = p_provider_call_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Call log not found');
  end if;

  if v_call_log.charged_at is not null then
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'call_log_id', v_call_log.id,
      'total_cost', v_call_log.total_cost
    );
  end if;

  if v_duration_seconds > 0 then
    v_billable_seconds := ceil(v_duration_seconds / 60.0)::integer * 60;
    v_total_cost := round((v_billable_seconds / 60.0) * coalesce(v_call_log.rate_per_min, 0), 4);
  end if;

  if v_total_cost > 0 then
    v_charge_result := public.deduct_balance(
      v_call_log.user_id,
      v_total_cost,
      v_call_log.id,
      format(
        'Call to %s (%s min)',
        coalesce(v_call_log.destination_number, 'unknown'),
        ceil(v_duration_seconds / 60.0)::integer
      )
    );

    if coalesce((v_charge_result->>'success')::boolean, false) = false then
      update public.call_logs
      set status = 'completed',
          duration_seconds = v_duration_seconds,
          billable_seconds = v_billable_seconds,
          total_cost = v_total_cost,
          ended_at = coalesce(p_ended_at, now()),
          billing_error = v_charge_result->>'error'
      where id = v_call_log.id;

      return jsonb_build_object(
        'success', false,
        'duplicate', false,
        'call_log_id', v_call_log.id,
        'total_cost', v_total_cost,
        'error', v_charge_result->>'error'
      );
    end if;
  end if;

  update public.call_logs
  set status = 'completed',
      duration_seconds = v_duration_seconds,
      billable_seconds = v_billable_seconds,
      total_cost = v_total_cost,
      ended_at = coalesce(p_ended_at, now()),
      charged_at = now(),
      billing_error = null
  where id = v_call_log.id;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'call_log_id', v_call_log.id,
    'total_cost', v_total_cost,
    'balance', v_charge_result->'balance'
  );
end;
$$;

revoke all on function public.add_balance(uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.deduct_balance(uuid, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public.get_user_balance(uuid) from public, anon, authenticated;
revoke all on function public.process_referral_bonus(uuid) from public, anon, authenticated;
revoke all on function public.process_stripe_checkout(text, uuid, numeric, numeric, uuid, text, text) from public, anon, authenticated;
revoke all on function public.process_completed_call(text, integer, timestamptz) from public, anon, authenticated;

grant execute on function public.add_balance(uuid, numeric, text, jsonb) to service_role;
grant execute on function public.deduct_balance(uuid, numeric, uuid, text) to service_role;
grant execute on function public.get_user_balance(uuid) to service_role;
grant execute on function public.process_referral_bonus(uuid) to service_role;
grant execute on function public.process_stripe_checkout(text, uuid, numeric, numeric, uuid, text, text) to service_role;
grant execute on function public.process_completed_call(text, integer, timestamptz) to service_role;
