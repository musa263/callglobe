// src/App.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useTwilio } from './hooks/useTwilio';
import { getCallRates, getRechargePackages, getCallHistory, createCheckoutSession } from './lib/supabase';
import AuthScreen from './pages/AuthScreen';
import SplashScreen from './pages/SplashScreen';
import DialerScreen from './pages/DialerScreen';
import ActiveCallScreen from './pages/ActiveCallScreen';
import HistoryScreen from './pages/HistoryScreen';
import RechargeScreen from './pages/RechargeScreen';
import RatesScreen from './pages/RatesScreen';
import TabBar from './components/TabBar';
import Header from './components/Header';

const VALID_TABS = new Set(['dialer', 'history', 'recharge', 'rates']);

function getTabFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  return VALID_TABS.has(tab) ? tab : 'dialer';
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState(() => getTabFromUrl());
  const [rates, setRates] = useState([]);
  const [packages, setPackages] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [dialNumber, setDialNumber] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState(null);

  const auth = useAuth();
  const telnyx = useTwilio(auth.user?.id);

  // Splash timer
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const syncUiWithUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const nextTab = getTabFromUrl();
      const success = params.get('success') === 'true';
      const canceled = params.get('canceled') === 'true';

      setActiveTab(nextTab);

      if (!success && !canceled) return;

      setActiveTab('recharge');
      setCheckoutNotice(
        success
          ? { type: 'success', message: 'Payment received. Your balance will refresh after confirmation.' }
          : { type: 'warning', message: 'Checkout was canceled. No charge was made.' }
      );

      params.set('tab', 'recharge');
      params.delete('success');
      params.delete('canceled');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    };

    syncUiWithUrl();
    window.addEventListener('popstate', syncUiWithUrl);
    return () => window.removeEventListener('popstate', syncUiWithUrl);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === activeTab && !params.has('success') && !params.has('canceled')) return;

    params.set('tab', activeTab);
    params.delete('success');
    params.delete('canceled');

    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [activeTab]);

  // Load data when authenticated
  useEffect(() => {
    if (!auth.isAuthenticated) return;

    const loadData = async () => {
      const [ratesResult, packagesResult, historyResult] = await Promise.all([
        getCallRates(),
        getRechargePackages(),
        getCallHistory(auth.user.id),
      ]);

      if (ratesResult.data) {
        setRates(ratesResult.data);
        // Default to US or first country
        const defaultCountry = ratesResult.data.find(r => r.country_code === 'US') || ratesResult.data[0];
        if (defaultCountry && !selectedCountry) setSelectedCountry(defaultCountry);
      }
      if (packagesResult.data) setPackages(packagesResult.data);
      if (historyResult.data) setHistory(historyResult.data);
    };

    loadData();
  }, [auth.isAuthenticated, auth.user?.id]);

  // Refresh history after call ends
  useEffect(() => {
    if (telnyx.callState === null && auth.user?.id) {
      getCallHistory(auth.user.id).then(({ data }) => {
        if (data) setHistory(data);
      });
      auth.refreshBalance();
    }
  }, [auth.refreshBalance, auth.user?.id, telnyx.callState]);

  useEffect(() => {
    if (checkoutNotice?.type !== 'success' || !auth.user?.id) return;

    const timer = setTimeout(() => {
      auth.refreshBalance();
    }, 1500);

    return () => clearTimeout(timer);
  }, [auth.refreshBalance, auth.user?.id, checkoutNotice]);

  // Handle starting a call
  const handleStartCall = async () => {
    if (!selectedCountry || !dialNumber) return;
    if (auth.balance < Number(selectedCountry.rate_per_min || 0)) return;
    const fullNumber = selectedCountry.dial_code + dialNumber;
    await telnyx.startCall(fullNumber, selectedCountry.country_code);
  };

  // Handle recharge
  const handleRecharge = async (packageId) => {
    try {
      await createCheckoutSession(packageId);
    } catch (error) {
      setCheckoutNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unable to start checkout right now.',
      });
      setActiveTab('recharge');
    }
  };

  // ── Render ──
  if (showSplash) return <SplashScreen />;
  if (auth.loading) return <SplashScreen />;
  if (!auth.isAuthenticated) return <AuthScreen auth={auth} />;
  if (telnyx.isInCall) {
    return (
      <ActiveCallScreen
        telnyx={telnyx}
        number={selectedCountry?.dial_code + dialNumber}
        country={selectedCountry}
        balance={auth.balance}
      />
    );
  }

  const estimatedMinutes = selectedCountry?.rate_per_min
    ? Math.floor(auth.balance / selectedCountry.rate_per_min)
    : 0;

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: '#0a0a0f', overflow: 'hidden',
    }}>
      <Header profile={auth.profile} onSignOut={auth.signOut} />

      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        {checkoutNotice && activeTab === 'recharge' && (
          <div style={{
            margin: '0 20px 16px',
            padding: '12px 14px',
            borderRadius: 14,
            border: `1px solid ${
              checkoutNotice.type === 'success'
                ? 'rgba(0,212,170,0.25)'
                : checkoutNotice.type === 'warning'
                  ? 'rgba(240,160,48,0.25)'
                  : 'rgba(255,107,107,0.25)'
            }`,
            background: checkoutNotice.type === 'success'
              ? 'rgba(0,212,170,0.08)'
              : checkoutNotice.type === 'warning'
                ? 'rgba(240,160,48,0.08)'
                : 'rgba(255,107,107,0.08)',
            color: checkoutNotice.type === 'success'
              ? '#00d4aa'
              : checkoutNotice.type === 'warning'
                ? '#f0a030'
                : '#ff6b6b',
            fontSize: 13,
            fontWeight: 500,
          }}>
            {checkoutNotice.message}
          </div>
        )}

        {activeTab === 'dialer' && (
          <DialerScreen
            balance={auth.balance}
            estimatedMinutes={estimatedMinutes}
            selectedCountry={selectedCountry}
            onSelectCountry={setSelectedCountry}
            dialNumber={dialNumber}
            onDialNumber={setDialNumber}
            onCall={handleStartCall}
            rates={rates}
            voiceReady={telnyx.isReady}
            callError={telnyx.error}
          />
        )}
        {activeTab === 'history' && (
          <HistoryScreen history={history} />
        )}
        {activeTab === 'recharge' && (
          <RechargeScreen
            balance={auth.balance}
            packages={packages}
            onRecharge={handleRecharge}
          />
        )}
        {activeTab === 'rates' && (
          <RatesScreen rates={rates} />
        )}
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
