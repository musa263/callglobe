import React, { Component, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronUp, PhoneCall, PhoneOff } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/features/auth/AuthContext';
import { VoiceRoot, useVoice } from './src/features/calling/VoiceContext';
import { MessagingProvider } from './src/features/messaging/MessagingContext';
import { BusinessProvider } from './src/features/organizations/BusinessContext';
import { BottomTabs } from './src/shared/components/BottomTabs';
import { AuthScreen } from './src/features/auth/screens/AuthScreen';
import { DialerScreen } from './src/features/calling/screens/DialerScreen';
import { ActiveCallScreen } from './src/features/calling/screens/ActiveCallScreen';
import { RecentsScreen } from './src/features/calling/screens/RecentsScreen';
import { WalletScreen } from './src/features/billing/screens/WalletScreen';
import { SettingsScreen } from './src/features/settings/screens/SettingsScreen';
import { ContactsScreen } from './src/features/contacts/screens/ContactsScreen';
import { MessagesScreen } from './src/features/messaging/screens/MessagesScreen';
import { ConferenceScreen } from './src/features/calling/screens/ConferenceScreen';
import { VideoMeetingScreen } from './src/features/video/screens/VideoMeetingScreen';
import type { AppTab, NavigationTarget } from './src/shared/types';
import { colors } from './src/shared/theme';

function AppContent() {
  const { loading, isAuthenticated } = useAuth();
  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.mint} size="large" /></View>;
  if (!isAuthenticated) return <AuthScreen />;
  return <BusinessProvider><MessagingProvider><AuthenticatedApp /></MessagingProvider></BusinessProvider>;
}

class LaunchBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <View style={styles.recovery}><Text style={styles.recoveryBrand}>VOCIVO</Text><Text style={styles.recoveryTitle}>Vocivo could not start</Text><Text style={styles.recoveryBody}>Close and reopen the app. Your account and calling data remain secure.</Text><Pressable onPress={() => this.setState({ failed: false })} style={styles.recoveryButton}><Text style={styles.recoveryButtonText}>Try again</Text></Pressable></View>;
    return this.props.children;
  }
}

function AuthenticatedApp() {
  const [tab, setTab] = useState<AppTab>('dial');
  const [showWallet, setShowWallet] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [dialTarget, setDialTarget] = useState<NavigationTarget | null>(null);
  const [messageTarget, setMessageTarget] = useState<NavigationTarget | null>(null);
  const [callSurface, setCallSurface] = useState<'direct' | 'conference'>('direct');
  const [callMinimized, setCallMinimized] = useState(false);
  const { activeCall, duration, endCall, startInternalCall } = useVoice();
  useEffect(() => { if (!activeCall) setCallMinimized(false); }, [activeCall]);
  if (activeCall && !callMinimized) return <ActiveCallScreen onMinimize={() => setCallMinimized(true)} />;
  if (showVideo) return <VideoMeetingScreen onClose={() => setShowVideo(false)} />;
  if (showWallet) return <WalletScreen onBack={() => setShowWallet(false)} />;
  const openDialer = (number: string, name?: string, internal = false, photoUrl?: string, countryCode?: string) => {
    setCallSurface('direct');
    setDialTarget({ number, name, internal, photoUrl, countryCode, nonce: Date.now() });
    setTab('dial');
  };
  const openMessages = (number: string, name?: string, internal = false) => {
    setMessageTarget({ number, name, internal, nonce: Date.now() });
    setTab('messages');
  };
  const changeTab = (next: AppTab) => {
    if (next === 'dial') setCallSurface('direct');
    setTab(next);
  };
  const callContact = async (contact: Parameters<React.ComponentProps<typeof ContactsScreen>['onCall']>[0]) => {
    try {
      if (contact.internal && contact.sipUsername && contact.extension) {
        await startInternalCall(contact.sipUsername, contact.extension, contact.name, contact.photoUrl);
        return;
      }
      // Keep contact country metadata and use the same validation/caller-ID
      // controls as a manually entered number before placing the call.
      openDialer(contact.number, contact.name, Boolean(contact.internal), contact.photoUrl, contact.countryCode);
    } catch (callError) {
      Alert.alert('Call could not start', callError instanceof Error ? callError.message : 'Try again shortly.');
    }
  };
  return (
    <View style={styles.app}>
      <View style={styles.screen}>
        {tab === 'dial' && callSurface === 'direct' && <DialerScreen target={dialTarget} onWallet={() => setShowWallet(true)} onConference={() => setCallSurface('conference')} />}
        {tab === 'dial' && callSurface === 'conference' && <ConferenceScreen onDirect={() => setCallSurface('direct')} onWallet={() => setShowWallet(true)} />}
        {tab === 'contacts' && <ContactsScreen onCall={callContact} onMessage={(contact) => openMessages(contact.number, contact.name, Boolean(contact.internal))} onVideoMeeting={() => setShowVideo(true)} />}
        {tab === 'recents' && <RecentsScreen onRedial={(call) => openDialer(call.destination_number, call.destination_name ?? call.destination_country ?? undefined, Boolean(call.internal || call.destination_country === 'Internal'))} />}
        {tab === 'messages' && <MessagesScreen target={messageTarget} onContacts={() => setTab('contacts')} />}
        {tab === 'settings' && <SettingsScreen onWallet={() => setShowWallet(true)} />}
      </View>
      {activeCall && callMinimized && <View style={styles.liveCallBar}>
        <Pressable accessibilityLabel="Return to active call" onPress={() => setCallMinimized(false)} style={styles.liveCallRestore}><View style={styles.liveCallIcon}><PhoneCall size={18} color={colors.ink} /></View><View style={styles.liveCallCopy}><Text numberOfLines={1} style={styles.liveCallName}>{activeCall.displayName || activeCall.number}</Text><Text style={styles.liveCallMeta}>{activeCall.onHold ? 'ON HOLD' : activeCall.phase === 'active' && activeCall.connectedAt ? 'LIVE CALL' : activeCall.phase.toUpperCase()}{activeCall.connectedAt ? ` · ${Math.floor(duration / 60).toString().padStart(2, '0')}:${(duration % 60).toString().padStart(2, '0')}` : ''}</Text></View><ChevronUp size={19} color={colors.textMuted} /></Pressable>
        <Pressable accessibilityLabel="End active call" onPress={() => endCall().catch((failure) => Alert.alert('Call still active', failure instanceof Error ? failure.message : 'Hangup was not acknowledged. Try again.'))} style={styles.liveCallEnd}><PhoneOff size={19} color={colors.white} /></Pressable>
      </View>}
      <BottomTabs active={tab} onChange={changeTab} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <LaunchBoundary><AuthProvider><VoiceRoot><AppContent /></VoiceRoot></AuthProvider></LaunchBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.ink },
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  recovery: { flex: 1, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  recoveryBrand: { color: colors.blue, fontSize: 12, fontWeight: '900', marginBottom: 18 },
  recoveryTitle: { color: colors.text, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  recoveryBody: { maxWidth: 330, color: colors.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  recoveryButton: { width: '100%', maxWidth: 280, height: 50, marginTop: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue },
  recoveryButtonText: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  liveCallBar: { height: 64, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.panelRaised, borderTopWidth: 1, borderTopColor: colors.mintDark },
  liveCallRestore: { flex: 1, minWidth: 0, height: 56, flexDirection: 'row', alignItems: 'center' },
  liveCallIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint },
  liveCallCopy: { flex: 1, minWidth: 0, paddingHorizontal: 10 }, liveCallName: { color: colors.text, fontSize: 13, fontWeight: '800' }, liveCallMeta: { color: colors.mint, fontSize: 8, fontWeight: '900', marginTop: 4 },
  liveCallEnd: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coral },
});
