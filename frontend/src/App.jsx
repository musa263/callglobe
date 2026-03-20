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

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState('dialer');
  const [rates, setRates] = useState([]);
  const [packages, setPackages] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [dialNumber, setDialNumber] = useState('');

  const auth = useAuth();
  const telnyx = useTwilio(auth.user?.id);

  // Splash timer
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(timer);
  }, []);

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
  }, [telnyx.callState]);

  // Handle starting a call
  const handleStartCall = async () => {
    if (!selectedCountry || !dialNumber || auth.balance <= 0) return;
    const fullNumber = selectedCountry.dial_code + dialNumber;
    await telnyx.startCall(fullNumber, selectedCountry.country_code, selectedCountry.rate_per_min);
  };

  // Handle recharge
  const handleRecharge = async (packageId) => {
    await createCheckoutSession(packageId);
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
