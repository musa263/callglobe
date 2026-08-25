import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Minus, PhoneCall, Plus, UsersRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '../components/BrandMark';
import { api } from '../lib/api';
import { colors } from '../theme';

const clean = (value: string) => value.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '').slice(0, 16);

export function ConferenceScreen({ onDirect, onWallet }: { onDirect: () => void; onWallet: () => void }) {
  const insets = useSafeAreaInsets();
  const [participants, setParticipants] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  const update = (index: number, value: string) => setParticipants((rows) => rows.map((row, rowIndex) => rowIndex === index ? clean(value) : row));
  const valid = participants.length >= 2 && participants.every((number) => /^\+[1-9]\d{6,14}$/.test(number));
  const start = async () => {
    setBusy(true); setError('');
    try { await api.post('/api/voice/conferences', { participants }); setStarted(true); }
    catch (conferenceError) { setError(conferenceError instanceof Error ? conferenceError.message : 'The conference could not be started.'); }
    finally { setBusy(false); }
  };

  return <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) }]} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><BrandMark compact /><Pressable onPress={onWallet} style={styles.balance}><Text style={styles.balanceText}>Balance</Text><Plus size={15} color={colors.mint} /></Pressable></View>
    <View style={styles.mode}><Pressable onPress={onDirect} style={styles.modeButton}><Text style={styles.modeText}>Direct call</Text></Pressable><View style={[styles.modeButton, styles.modeActive]}><Text style={styles.modeActiveText}>Conference</Text></View></View>
    <View style={styles.intro}><View style={styles.icon}><UsersRound size={28} color={colors.mint} /></View><Text style={styles.title}>Merged conference call</Text><Text style={styles.subtitle}>Add 2 to 5 international numbers. Vocivo rings you first, then joins every answered caller into one room.</Text></View>
    {started ? <View style={styles.success}><PhoneCall size={26} color={colors.mint} /><Text style={styles.successTitle}>Answer the incoming host call</Text><Text style={styles.successText}>Participants will be called and merged after you answer.</Text><Pressable onPress={() => setStarted(false)} style={styles.secondary}><Text style={styles.secondaryText}>Start another conference</Text></Pressable></View> : <>
      <Text style={styles.label}>PARTICIPANTS</Text>
      {participants.map((number, index) => <View key={index} style={styles.row}><View style={styles.position}><Text style={styles.positionText}>{index + 1}</Text></View><TextInput value={number} onChangeText={(value) => update(index, value)} placeholder="+234..." placeholderTextColor={colors.textFaint} keyboardType="phone-pad" autoCorrect={false} style={styles.input} />{participants.length > 2 && <Pressable accessibilityLabel="Remove participant" onPress={() => setParticipants((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} style={styles.remove}><Minus size={18} color={colors.coral} /></Pressable>}</View>)}
      {participants.length < 5 && <Pressable onPress={() => setParticipants((rows) => [...rows, ''])} style={styles.add}><Plus size={17} color={colors.mint} /><Text style={styles.addText}>Add participant</Text></Pressable>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable disabled={!valid || busy} onPress={start} style={[styles.start, (!valid || busy) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.ink} /> : <><UsersRound size={20} color={colors.ink} /><Text style={styles.startText}>Start merged conference</Text></>}</Pressable>
      <Text style={styles.note}>Use full international format beginning with +. Standard calling charges apply to each participant leg.</Text>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink }, content: { minHeight: '100%', paddingHorizontal: 20, paddingBottom: 36 }, header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, balance: { height: 36, paddingHorizontal: 11, borderRadius: 8, flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }, balanceText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' }, mode: { height: 42, padding: 3, marginTop: 12, flexDirection: 'row', backgroundColor: colors.panel, borderRadius: 8 }, modeButton: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, modeActive: { backgroundColor: colors.panelRaised }, modeText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' }, modeActiveText: { color: colors.mint, fontSize: 12, fontWeight: '800' }, intro: { alignItems: 'center', paddingVertical: 28 }, icon: { width: 58, height: 58, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12334A' }, title: { color: colors.text, fontSize: 23, fontWeight: '800', marginTop: 16 }, subtitle: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8, maxWidth: 330 }, label: { color: colors.textFaint, fontSize: 10, fontWeight: '900', marginBottom: 7 }, row: { height: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line }, position: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel }, positionText: { color: colors.textMuted, fontSize: 11, fontWeight: '900' }, input: { flex: 1, height: 54, paddingHorizontal: 12, color: colors.text, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] }, remove: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, add: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 8 }, addText: { color: colors.mint, fontSize: 12, fontWeight: '800' }, error: { color: colors.coral, textAlign: 'center', fontSize: 11, marginTop: 8 }, start: { height: 52, marginTop: 20, borderRadius: 8, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint }, disabled: { opacity: 0.3 }, startText: { color: colors.ink, fontSize: 14, fontWeight: '900' }, note: { color: colors.textFaint, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10 }, success: { minHeight: 240, padding: 24, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, successTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 15 }, successText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 7 }, secondary: { height: 42, marginTop: 22, paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center', backgroundColor: colors.panelRaised }, secondaryText: { color: colors.mint, fontSize: 11, fontWeight: '800' },
});
