import React, { useState } from 'react';
import { registerRootComponent } from 'expo';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RecentsScreen } from '../../src/features/calling/screens/RecentsScreen';
import { DialerScreen } from '../../src/features/calling/screens/DialerScreen';
import { ActiveCallScreen } from '../../src/features/calling/screens/ActiveCallScreen';
import { ConferenceScreen } from '../../src/features/calling/screens/ConferenceScreen';
import { BottomTabs } from '../../src/shared/components/BottomTabs';
import { FixtureProvider, useVoice } from './fixtures';
import type { AppTab, NavigationTarget } from '../../src/shared/types';

function Screens() {
  const [screen, setScreen] = useState('dial');
  const [tab, setTab] = useState<AppTab>('dial');
  const [target, setTarget] = useState<NavigationTarget | null>(null);
  const { activeCall } = useVoice();
  const [minimized, setMinimized] = useState(false);
  const dial = () => setScreen('dial');
  const fullCall = Boolean(activeCall && !minimized);
  return <View style={{ flex: 1, backgroundColor: '#07111F' }}>
    <View style={{ flex: 1 }}>
    {fullCall ? <ActiveCallScreen onMinimize={() => { setMinimized(true); setTab('dial'); setScreen('dial'); }} /> : tab === 'recents'
      ? <RecentsScreen onRedial={(call) => { setTarget({ number: call.destination_number, name: call.destination_name || undefined, internal: call.internal, nonce: Date.now() }); setTab('dial'); dial(); }} /> : tab !== 'dial'
      ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><Text style={{ color: '#FFFFFF', fontSize: 24 }}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text><Text style={{ color: '#A9BACB', textAlign: 'center', marginTop: 16 }}>This screen is not loaded in the isolated calling preview. It remains available in the full app.</Text></View>
      : screen === 'conference' ? <ConferenceScreen onDirect={dial} onWallet={() => undefined} />
      : <DialerScreen onWallet={() => undefined} onConference={() => setScreen('conference')} target={target} />}
    </View>
    <Pressable onPress={() => { setTab('dial'); setMinimized(false); setTarget({ number: '2001', name: 'Jamie Roberts', internal: true, nonce: Date.now() }); dial(); }} style={{ alignItems: 'center', padding: 6 }}><Text style={{ color: '#A9BACB', fontSize: 10 }}>Local UI fixture · No live calls</Text></Pressable>
    {!fullCall && <BottomTabs active={tab} onChange={(next) => { setTab(next); if (next === 'dial') setScreen('dial'); }} />}
  </View>;
}
registerRootComponent(() => <SafeAreaProvider><FixtureProvider><Screens /></FixtureProvider></SafeAreaProvider>);
