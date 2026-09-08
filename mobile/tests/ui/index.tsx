import React, { useState } from 'react';
import { registerRootComponent } from 'expo';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RecentsScreen } from '../../src/features/calling/screens/RecentsScreen';
import { DialerScreen } from '../../src/features/calling/screens/DialerScreen';
import { ActiveCallScreen } from '../../src/features/calling/screens/ActiveCallScreen';
import { ConferenceScreen } from '../../src/features/calling/screens/ConferenceScreen';
import { ContactsScreen } from '../../src/features/contacts/screens/ContactsScreen';
import { MessagesScreen } from '../../src/features/messaging/screens/MessagesScreen';
import { SettingsScreen } from '../../src/features/settings/screens/SettingsScreen';
import { LaunchScreen } from '../../src/features/auth/screens/LaunchScreen';
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
      ? <RecentsScreen onRedial={(call) => { setTarget({ number: call.destination_number, name: call.destination_name || undefined, internal: call.internal, nonce: Date.now() }); setTab('dial'); dial(); }} /> : tab === 'contacts'
      ? <ContactsScreen onCall={() => undefined} onMessage={() => setTab('messages')} onVideoMeeting={() => undefined} /> : tab === 'messages'
      ? <MessagesScreen target={null} onContacts={() => setTab('contacts')} /> : tab === 'settings'
      ? <SettingsScreen onWallet={() => undefined} /> : screen === 'launch' ? <LaunchScreen />
      : screen === 'conference' ? <ConferenceScreen onDirect={dial} onWallet={() => undefined} />
      : <DialerScreen onWallet={() => undefined} onConference={() => setScreen('conference')} target={target} />}
    </View>
    <Pressable accessibilityLabel="Preview launch screen" onPress={() => { setTab('dial'); setScreen(screen === 'launch' ? 'dial' : 'launch'); }} style={{ alignItems: 'center', padding: 6 }}><Text style={{ color: '#A9BACB', fontSize: 10 }}>Local UI fixture · No live calls</Text></Pressable>
    {!fullCall && <BottomTabs active={tab} onChange={(next) => { setTab(next); if (next === 'dial') setScreen('dial'); }} />}
  </View>;
}
registerRootComponent(() => <SafeAreaProvider><FixtureProvider><Screens /></FixtureProvider></SafeAreaProvider>);
