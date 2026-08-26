import React, { useState } from 'react';
import { ActivityIndicator, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Building2, CircleDollarSign, Clock3, Phone, PhoneCall, UsersRound, Wifi } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '../components/BrandMark';
import { useAuth } from '../context/AuthContext';
import { useBusiness } from '../context/BusinessContext';
import { useVoice } from '../context/VoiceContext';
import { colors, shadow } from '../theme';
import type { CallLog } from '../types';

const heritageImage = require('../../assets/global-heritage-home.png');

function PrimaryAction({ icon: Icon, title, detail, onPress, secondary = false }: { icon: React.ElementType; title: string; detail: string; onPress: () => void; secondary?: boolean }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.action, secondary && styles.actionSecondary, pressed && styles.pressed]}>
    <View style={[styles.actionIcon, secondary && styles.actionIconSecondary]}><Icon size={21} color={secondary ? colors.blue : colors.ink} /></View>
    <View style={styles.actionCopy}><Text style={[styles.actionTitle, !secondary && styles.actionTitleDark]}>{title}</Text><Text style={[styles.actionDetail, !secondary && styles.actionDetailDark]}>{detail}</Text></View>
  </Pressable>;
}

function relativeCallTime(value: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function HomeScreen({ onDial, onConference, onBusiness, onWallet, onRecentCall }: { onDial: () => void; onConference: () => void; onBusiness: () => void; onWallet: () => void; onRecentCall: (call: CallLog) => void }) {
  const insets = useSafeAreaInsets();
  const { profile, callerNumbers, history } = useAuth();
  const { isReady } = useVoice();
  const { profile: business, saveProfile } = useBusiness();
  const [switchingMode, setSwitchingMode] = useState(false);
  const firstName = profile?.full_name?.split(/\s+/)[0] || 'there';
  const primaryNumber = callerNumbers.find((number) => number.source === 'owned')?.phone_number || callerNumbers[0]?.phone_number || (business.enabled ? 'No company number assigned' : 'No caller ID assigned');
  const backgroundSource = business.backgroundImageUrl ? { uri: business.backgroundImageUrl } : heritageImage;

  const changeMode = async (enabled: boolean) => {
    if (business.enabled === enabled || switchingMode) return;
    setSwitchingMode(true);
    try { await saveProfile({ ...business, enabled }); } finally { setSwitchingMode(false); }
  };

  return <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) }]} showsVerticalScrollIndicator={false}>
    <View style={styles.header}>
      <BrandMark compact />
      <Pressable accessibilityLabel="Open calling balance" onPress={onWallet} style={styles.balance}><CircleDollarSign size={17} color={colors.mint} /><Text style={styles.balanceText}>${Number(profile?.balance ?? 0).toFixed(2)}</Text></Pressable>
    </View>

    <View style={styles.welcome}><Text style={styles.eyebrow}>VOCIVO WORKSPACE</Text><Text style={styles.title}>Hello, {firstName}</Text><Text style={styles.subtitle}>Your international phone system, ready when you are.</Text></View>

    <View style={styles.mode} accessibilityLabel="Call handling mode">
      <Pressable onPress={() => changeMode(false)} style={[styles.modeButton, !business.enabled && styles.modeButtonActive]}><Phone size={16} color={!business.enabled ? colors.ink : colors.textMuted} /><Text style={[styles.modeText, !business.enabled && styles.modeTextActive]}>Personal</Text></Pressable>
      <Pressable onPress={() => changeMode(true)} style={[styles.modeButton, business.enabled && styles.modeButtonActive]}><Building2 size={16} color={business.enabled ? colors.ink : colors.textMuted} /><Text style={[styles.modeText, business.enabled && styles.modeTextActive]}>Business</Text></Pressable>
      {switchingMode && <View style={styles.modeBusy}><ActivityIndicator size="small" color={colors.mint} /></View>}
    </View>

    <ImageBackground source={backgroundSource} resizeMode="cover" style={styles.availability} imageStyle={styles.availabilityImage}>
      <View style={styles.imageShade} />
      <View style={styles.lineTop}><View style={[styles.onlinePill, !isReady && styles.waitingPill]}><View style={[styles.onlineDot, !isReady && styles.waitingDot]} /><Text style={[styles.onlineText, !isReady && styles.waitingText]}>{isReady ? 'AVAILABLE' : 'CONNECTING'}</Text></View><View style={styles.lineIcon}>{isReady ? <PhoneCall size={23} color={colors.white} /> : <Wifi size={23} color={colors.amber} />}</View></View>
      <View style={styles.lineCopy}><Text style={styles.lineEyebrow}>{business.enabled ? 'BUSINESS LINE' : 'PERSONAL LINE'}</Text><Text style={styles.availabilityTitle}>{isReady ? 'Ready for incoming calls' : 'Connecting your line'}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.number}>{primaryNumber}</Text></View>
    </ImageBackground>

    <View style={styles.actions}>
      <PrimaryAction icon={Phone} title="New call" detail="Open the dialpad" onPress={onDial} />
      <PrimaryAction icon={UsersRound} title="Conference" detail="Connect up to five lines" onPress={onConference} secondary />
    </View>

    <Text style={styles.sectionLabel}>BUSINESS PHONE SYSTEM</Text>
    <Pressable onPress={onBusiness} style={({ pressed }) => [styles.business, pressed && styles.pressed]}>
      <View style={styles.businessIcon}><Building2 size={21} color={business.enabled ? colors.mint : colors.textMuted} /></View>
      <View style={styles.businessCopy}><Text style={styles.businessTitle}>{business.enabled ? business.companyName : 'Professional Voice'}</Text><Text numberOfLines={1} style={styles.businessText}>{business.enabled ? `${business.departments.length} divisions · Welcome menu active` : 'Greeting, extensions and waiting message'}</Text></View>
      <View style={[styles.systemState, business.enabled && styles.systemStateLive]}><Text style={[styles.systemStateText, business.enabled && styles.systemStateTextLive]}>{business.enabled ? 'ACTIVE' : 'SET UP'}</Text></View>
    </Pressable>

    <View style={styles.sectionHeading}><Text style={styles.sectionLabel}>RECENT CALLS</Text><Text style={styles.sectionHint}>Last 3</Text></View>
    <View style={styles.recents}>
      {history.slice(0, 3).map((call) => <Pressable key={call.id} onPress={() => onRecentCall(call)} style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}>
        <View style={styles.recentIcon}><Clock3 size={17} color={call.status === 'completed' ? colors.blue : colors.coral} /></View>
        <View style={styles.recentCopy}><Text numberOfLines={1} style={styles.recentName}>{call.destination_name || (/^sip:/i.test(call.destination_number) ? 'Internal call' : call.destination_number)}</Text><Text numberOfLines={1} style={styles.recentMeta}>{call.internal || call.destination_country === 'Internal' ? `Extension ${call.destination_number.replace(/\D/g, '') || 'call'}` : call.destination_name ? call.destination_number : call.destination_country || 'Phone call'} · {relativeCallTime(call.started_at)}</Text></View>
        <Phone size={17} color={colors.mint} />
      </Pressable>)}
      {!history.length && <View style={styles.noRecents}><Clock3 size={18} color={colors.textFaint} /><Text style={styles.noRecentsText}>Your latest calls will appear here.</Text></View>}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink }, content: { paddingHorizontal: 20, paddingBottom: 34 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, balance: { height: 36, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 8, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }, balanceText: { color: colors.text, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  welcome: { paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: colors.mint, fontSize: 9, fontWeight: '900' }, title: { color: colors.text, fontSize: 27, lineHeight: 33, fontWeight: '800', marginTop: 6 }, subtitle: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  mode: { height: 46, padding: 3, marginBottom: 10, position: 'relative', flexDirection: 'row', borderRadius: 8, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }, modeButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 6 }, modeButtonActive: { backgroundColor: colors.mint }, modeText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' }, modeTextActive: { color: colors.ink }, modeBusy: { position: 'absolute', right: 10, top: 11 },
  availability: { width: '100%', aspectRatio: 1.788, minHeight: 190, justifyContent: 'space-between', padding: 16, overflow: 'hidden', borderRadius: 8, borderWidth: 1, borderColor: '#3A6684', ...shadow }, availabilityImage: { borderRadius: 8 }, imageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: '#05111F9E' }, lineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, lineIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B6F9CCC', borderWidth: 1, borderColor: '#70D6FF80' }, onlinePill: { height: 27, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 6, backgroundColor: '#0B3149DD' }, waitingPill: { backgroundColor: '#302A1BDD' }, onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mint }, waitingDot: { backgroundColor: colors.amber }, onlineText: { color: colors.mint, fontSize: 8, fontWeight: '900' }, waitingText: { color: colors.amber }, lineCopy: { paddingRight: 12 }, lineEyebrow: { color: colors.mint, fontSize: 9, fontWeight: '900' }, availabilityTitle: { color: colors.white, fontSize: 21, lineHeight: 27, fontWeight: '900', marginTop: 7 }, number: { maxWidth: '86%', color: '#C5D5E3', fontSize: 13, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 }, action: { flex: 1, minHeight: 78, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderRadius: 8, backgroundColor: colors.mint, borderWidth: 1, borderColor: colors.mint }, actionSecondary: { backgroundColor: colors.panel, borderColor: colors.line }, actionIcon: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF70' }, actionIconSecondary: { backgroundColor: '#172F4D' }, actionCopy: { flex: 1, minWidth: 0, paddingLeft: 9 }, actionTitle: { color: colors.text, fontSize: 12, fontWeight: '900' }, actionTitleDark: { color: colors.ink }, actionDetail: { color: colors.textMuted, fontSize: 9, lineHeight: 13, marginTop: 3 }, actionDetailDark: { color: '#17354A' }, pressed: { opacity: 0.68 },
  sectionLabel: { color: colors.textFaint, fontSize: 9, fontWeight: '900', marginTop: 24, marginBottom: 9 }, business: { minHeight: 70, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, businessIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' }, businessCopy: { flex: 1, minWidth: 0, paddingHorizontal: 11 }, businessTitle: { color: colors.text, fontSize: 13, fontWeight: '800' }, businessText: { color: colors.textMuted, fontSize: 10, marginTop: 4 }, systemState: { height: 25, paddingHorizontal: 8, borderRadius: 6, backgroundColor: colors.panel, justifyContent: 'center' }, systemStateLive: { backgroundColor: '#12334A' }, systemStateText: { color: colors.textFaint, fontSize: 8, fontWeight: '900' }, systemStateTextLive: { color: colors.mint },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionHint: { color: colors.textFaint, fontSize: 9, fontWeight: '800', marginTop: 24, marginBottom: 9 },
  recents: { borderTopWidth: 1, borderTopColor: colors.line }, recentRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line }, recentIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel }, recentCopy: { flex: 1, minWidth: 0 }, recentName: { color: colors.text, fontSize: 12, fontWeight: '800' }, recentMeta: { color: colors.textMuted, fontSize: 9, marginTop: 4 }, noRecents: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 9 }, noRecentsText: { color: colors.textMuted, fontSize: 11 },
});
