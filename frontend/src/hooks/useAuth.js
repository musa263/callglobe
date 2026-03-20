// src/hooks/useAuth.js
import { useState, useEffect, useCallback } from 'react';
import {
  supabase,
  signUp,
  signIn,
  signOut,
  getProfile,
  normalizePromotionalBalance,
  subscribeToBalance,
} from '../lib/supabase';

const AUTH_BOOT_TIMEOUT_MS = 4000;

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const resetAuthState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setBalance(0);
  }, []);

  const loadProfile = useCallback(async (userId) => {
    try {
      const { data: prof, error: profileError } = await getProfile(userId);
      if (profileError) {
        throw profileError;
      }

      let nextProfile = prof;
      if (
        nextProfile
        && Number(nextProfile.balance || 0) === 2.5
        && Number(nextProfile.total_recharged || 0) === 0
        && Number(nextProfile.total_spent || 0) === 0
      ) {
        const { data: normalizedResult, error: normalizeError } = await normalizePromotionalBalance();
        if (normalizeError) {
          console.error('Failed to normalize promotional balance:', normalizeError);
        } else if (normalizedResult?.profile) {
          nextProfile = normalizedResult.profile;
        }
      }

      if (nextProfile) {
        setProfile(nextProfile);
        setBalance(Number(nextProfile.balance || 0));
      }

      return nextProfile;
    } catch (profileLoadError) {
      console.error('Failed to load profile:', profileLoadError);
      setProfile(null);
      setBalance(0);
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const finishLoading = () => {
      if (isMounted) {
        setLoading(false);
      }
    };

    const initAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        if (!isMounted) return;

        if (session?.user) {
          setUser(session.user);
          await loadProfile(session.user.id);
        } else {
          resetAuthState();
        }
      } catch (authInitError) {
        console.error('Auth initialization failed:', authInitError);
        if (isMounted) {
          setError('Unable to initialize authentication.');
          resetAuthState();
        }
      } finally {
        finishLoading();
      }
    };

    const loadingTimer = setTimeout(() => {
      console.warn('Auth initialization timed out. Continuing without blocking the UI.');
      finishLoading();
    }, AUTH_BOOT_TIMEOUT_MS);

    initAuth();

    const handleAuthChange = async (session) => {
      if (!isMounted) return;

      setError(null);

      if (session?.user) {
        setUser(session.user);
        await loadProfile(session.user.id);
      } else {
        resetAuthState();
      }

      finishLoading();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        void handleAuthChange(session);
      }, 0);
    });

    return () => {
      isMounted = false;
      clearTimeout(loadingTimer);
      subscription.unsubscribe();
    };
  }, [loadProfile, resetAuthState]);

  useEffect(() => {
    if (!user) return undefined;

    const channel = subscribeToBalance(user.id, (newBalance) => {
      setBalance(Number(newBalance || 0));
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleSignUp = useCallback(async (email, password, name) => {
    setError(null);
    const { error: signUpError } = await signUp(email, password, name);
    if (signUpError) {
      setError(signUpError.message);
      return false;
    }
    return true;
  }, []);

  const handleSignIn = useCallback(async (email, password) => {
    setError(null);
    const { error: signInError } = await signIn(email, password);
    if (signInError) {
      setError(signInError.message);
      return false;
    }
    return true;
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    resetAuthState();
  }, [resetAuthState]);

  const refreshBalance = useCallback(async () => {
    if (!user) return;
    await loadProfile(user.id);
  }, [loadProfile, user]);

  return {
    user,
    profile,
    balance,
    loading,
    error,
    signUp: handleSignUp,
    signIn: handleSignIn,
    signOut: handleSignOut,
    refreshBalance,
    isAuthenticated: !!user,
  };
}
