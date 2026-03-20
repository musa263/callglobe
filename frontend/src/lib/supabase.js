// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

function getRequiredEnv(name) {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const supabaseUrl = getRequiredEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = getRequiredEnv('VITE_SUPABASE_ANON_KEY');

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ============================================================
// AUTH
// ============================================================
export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  return { data, error };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ============================================================
// PROFILE & BALANCE
// ============================================================
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
}

export async function normalizePromotionalBalance() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { data: null, error: new Error('Unauthorized') };
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/normalize-profile`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
    }
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      data: null,
      error: new Error(result.error || 'Unable to normalize profile balance.'),
    };
  }

  return { data: result, error: null };
}

export async function getBalance(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('balance')
    .eq('id', userId)
    .single();
  return data?.balance || 0;
}

// Subscribe to real-time balance changes
export function subscribeToBalance(userId, callback) {
  return supabase
    .channel(`balance:${userId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'profiles',
      filter: `id=eq.${userId}`,
    }, (payload) => {
      callback(payload.new.balance);
    })
    .subscribe();
}

// ============================================================
// CALL RATES
// ============================================================
export async function getCallRates() {
  const { data, error } = await supabase
    .from('call_rates')
    .select('*')
    .eq('is_active', true)
    .order('country_name');
  return { data: data || [], error };
}

export async function getRateForCountry(countryCode) {
  const { data } = await supabase
    .from('call_rates')
    .select('*')
    .eq('country_code', countryCode)
    .eq('is_active', true)
    .single();
  return data;
}

// ============================================================
// RECHARGE PACKAGES
// ============================================================
export async function getRechargePackages() {
  const { data, error } = await supabase
    .from('recharge_packages')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  return { data: data || [], error };
}

// ============================================================
// CALL LOGS
// ============================================================
export async function getCallHistory(userId, limit = 50) {
  const { data, error } = await supabase
    .from('call_logs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

// ============================================================
// TRANSACTIONS
// ============================================================
export async function getTransactions(userId, limit = 50) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

// ============================================================
// STRIPE CHECKOUT
// ============================================================
export async function createCheckoutSession(packageId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You must be signed in to recharge.');
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/create-checkout`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        package_id: packageId,
        success_url: `${window.location.origin}/?tab=recharge&success=true`,
        cancel_url: `${window.location.origin}/?tab=recharge&canceled=true`,
      }),
    }
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Unable to start checkout.');
  }

  if (!result.url) {
    throw new Error('Checkout URL missing from server response.');
  }

  window.location.assign(result.url);
  return result;
}
