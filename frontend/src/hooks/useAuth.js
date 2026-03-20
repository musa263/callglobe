// src/hooks/useAuth.js
import { useState, useEffect, useCallback } from 'react';
import { supabase, signUp, signIn, signOut, getProfile, subscribeToBalance } from '../lib/supabase';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check session on mount
  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        const { data: prof } = await getProfile(session.user.id);
        if (prof) {
          setProfile(prof);
          setBalance(prof.balance);
        }
      }
      setLoading(false);
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        const { data: prof } = await getProfile(session.user.id);
        if (prof) {
          setProfile(prof);
          setBalance(prof.balance);
        }
      } else {
        setUser(null);
        setProfile(null);
        setBalance(0);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Subscribe to real-time balance updates
  useEffect(() => {
    if (!user) return;

    const channel = subscribeToBalance(user.id, (newBalance) => {
      setBalance(newBalance);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleSignUp = useCallback(async (email, password, name) => {
    setError(null);
    const { data, error: err } = await signUp(email, password, name);
    if (err) {
      setError(err.message);
      return false;
    }
    return true;
  }, []);

  const handleSignIn = useCallback(async (email, password) => {
    setError(null);
    const { data, error: err } = await signIn(email, password);
    if (err) {
      setError(err.message);
      return false;
    }
    return true;
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
    setProfile(null);
    setBalance(0);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!user) return;
    const { data: prof } = await getProfile(user.id);
    if (prof) {
      setBalance(prof.balance);
      setProfile(prof);
    }
  }, [user]);

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
