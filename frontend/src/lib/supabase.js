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

function getFunctionErrorMessage(result, fallbackMessage) {
  if (!result) return fallbackMessage;
  if (typeof result === 'string') return result;
  return result.error || result.message || fallbackMessage;
}

async function parseFunctionResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getAccessToken({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      throw error;
    }
    return data.session?.access_token || null;
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (!session) {
    return null;
  }

  const expiresSoon = session.expires_at
    ? (session.expires_at * 1000) - Date.now() < 60_000
    : false;

  if (!expiresSoon) {
    return session.access_token;
  }

  const { data, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    console.warn('Session refresh failed before calling edge function:', refreshError);
    return session.access_token;
  }

  return data.session?.access_token || session.access_token;
}

export async function invokeAuthenticatedFunction(
  functionName,
  {
    method = 'POST',
    body,
    unauthenticatedMessage = 'You must be signed in.',
  } = {}
) {
  async function execute(forceRefresh = false) {
    const accessToken = await getAccessToken({ forceRefresh });
    if (!accessToken) {
      throw new Error(unauthenticatedMessage);
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'Authorization': `Bearer ${accessToken}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const result = await parseFunctionResponse(response);

    if (response.status === 401 && !forceRefresh) {
      return execute(true);
    }

    if (!response.ok) {
      throw new Error(
        getFunctionErrorMessage(result, `Request failed (${response.status})`)
      );
    }

    return result;
  }

  return execute(false);
}

// ============================================================
// AUTH
// ============================================================
export async function signUp(email, password, fullName) {
  const response = await fetch(`${supabaseUrl}/functions/v1/register-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      full_name: fullName,
    }),
  });

  const result = await parseFunctionResponse(response);
  if (!response.ok) {
    return {
      data: null,
      error: new Error(getFunctionErrorMessage(result, 'Unable to create account.')),
    };
  }

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const signInResult = await supabase.auth.signInWithPassword({ email, password });
    if (!signInResult.error) {
      return signInResult;
    }

    lastError = signInResult.error;
    if (!/invalid login credentials/i.test(signInResult.error.message)) {
      break;
    }

    await sleep(300 * (attempt + 1));
  }

  return {
    data: null,
    error: lastError || new Error('Account created, but automatic sign-in failed. Please log in.'),
  };
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
  try {
    const data = await invokeAuthenticatedFunction('normalize-profile', {
      unauthenticatedMessage: 'Unauthorized',
    });
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error
        ? error
        : new Error('Unable to normalize profile balance.'),
    };
  }
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
  const result = await invokeAuthenticatedFunction('create-checkout', {
    unauthenticatedMessage: 'You must be signed in to recharge.',
    body: {
      package_id: packageId,
      success_url: `${window.location.origin}/?tab=recharge&success=true`,
      cancel_url: `${window.location.origin}/?tab=recharge&canceled=true`,
    },
  });

  if (!result.url) {
    throw new Error('Checkout URL missing from server response.');
  }

  window.location.assign(result.url);
  return result;
}
