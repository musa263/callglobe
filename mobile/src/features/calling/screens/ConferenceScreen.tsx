import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, CircleDollarSign, Minus, PhoneCall, Plus, RotateCw, Search, UserRound, UsersRound, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageHeading } from '../../../shared/components/PageHeading';
import { useLocales } from 'expo-localization';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../../shared/api';
import { colors } from '../../../shared/theme';
import { PresenceDot } from '../components/PresenceDot';
import { cleanDialInput, defaultDialRegion, dialRegion, resolveCallDestination } from '../state/dialNumber';
import { useCallingDirectory } from '../state/useCallingDirectory';

type Participant = { id: string; number: string };

const newParticipant = (index: number): Participant => ({ id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`, number: '' });

export function ConferenceScreen({ onDirect, onWallet }: { onDirect: () => void; onWallet: () => void }) {
  const insets = useSafeAreaInsets();
  const { profile, rates, callerNumbers } = useAuth();
  const locales = useLocales();
  const region = dialRegion(profile?.dialing_country) || (profile?.account_type !== 'business' ? defaultDialRegion(locales[0]?.regionCode, profile?.mobile) : undefined);
  const selectedCaller = callerNumbers.find(number => number.phone_number === profile?.outbound_caller_id) || (profile?.account_type !== 'business' ? callerNumbers[0] : null);
  const [participants, setParticipants] = useState<Participant[]>(() => [newParticipant(0), newParticipant(1)]);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const businessAccount = profile?.account_type === 'business' && Boolean(profile.extension);
  const directory = useCallingDirectory(businessAccount, profile?.organization_id, profile?.id);
  const loadingDirectory = directory.status === 'loading';

  const update = (id: string, patch: Partial<Participant>) => setParticipants((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  const routes = participants.map((row) => resolveCallDestination(row.number, { business: businessAccount, ownExtension: profile?.extension, directory: directory.users, region, rates }));
  const values = routes.map((route) => route.kind === 'internal' ? `ext:${route.colleague!.id}` : route.destination.number);
  const duplicate = values.some((value, index) => value && values.indexOf(value) !== index);
  const hasExternal = routes.some((route) => route.kind === 'external');
  const valid = participants.length >= 2
    && routes.every((route) => route.kind === 'internal' || route.kind === 'external') && !duplicate && (!hasExternal || Boolean(selectedCaller));
  const filteredDirectory = useMemo(() => {
    const query = search.trim().toLowerCase();
    return directory.users.filter((user) => user.extension !== profile?.extension && (!query || `${user.name} ${user.extension} ${user.department || ''}`.toLowerCase().includes(query)));
  }, [directory.users, profile?.extension, search]);

  const start = async () => {
    if (!valid || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/voice/conferences', {
        participants: routes.map((route) => route.kind === 'internal'
          ? { type: 'extension', extensionId: route.colleague!.id }
          : { type: 'external', number: route.destination.number }),
        ...(hasExternal ? { callerId: selectedCaller?.phone_number } : {}),
      });
      setStarted(true);
    } catch (conferenceError) {
      setError(conferenceError instanceof Error ? conferenceError.message : 'The conference could not be started.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return <>
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) }]} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to calls" onPress={onDirect} style={styles.close}><ArrowLeft size={22} color={colors.text} /></Pressable><View style={{ flex: 1 }}><PageHeading title="Conference" /></View><Pressable accessibilityRole="button" accessibilityLabel="Open calling balance" onPress={onWallet} style={styles.close}><CircleDollarSign size={21} color={colors.mint} /></Pressable></View>
      {started ? <View style={styles.success}><PhoneCall size={26} color={colors.mint} /><Text style={styles.successTitle}>Answer the host call</Text><Text style={styles.successText}>Vocivo will join each participant after you answer.</Text><Pressable onPress={() => setStarted(false)} style={styles.secondary}><Text style={styles.secondaryText}>Start another conference</Text></Pressable></View> : <>
        <Text style={styles.participantsHeading}>Participants</Text>
        {participants.map((row, index) => {
          const route = routes[index]!;
          const detail = route.kind === 'internal' ? `${route.colleague!.name} · Extension ${route.input} · Free`
            : route.kind === 'external' ? route.destination.formatted : route.kind === 'self' ? 'You are already the host'
              : route.kind === 'unknown-extension' ? loadingDirectory ? 'Finding colleague...' : directory.status === 'failed' ? 'Company directory unavailable' : 'No matching company extension' : ' ';
          return <View key={row.id} style={styles.participant}>
            <View style={styles.participantTop}>
              <Text style={styles.participantName}>Participant {index + 1}</Text>
              {participants.length > 2 && <Pressable accessibilityRole="button" accessibilityLabel={`Remove participant ${index + 1}`} disabled={busy} onPress={() => setParticipants((rows) => rows.filter((candidate) => candidate.id !== row.id))} style={styles.close}><Minus size={18} color={colors.textMuted} /></Pressable>}
            </View>
            <View style={styles.numberRow}><TextInput accessibilityLabel={`Participant ${index + 1} number`} editable={!busy} value={row.number} onChangeText={(number) => { setError(''); update(row.id, { number: cleanDialInput(number) }); }} placeholder={businessAccount ? 'Number or extension' : 'Phone number'} placeholderTextColor={colors.textFaint} keyboardType="phone-pad" autoCorrect={false} style={styles.numberInput} />
              {businessAccount && <Pressable accessibilityRole="button" accessibilityLabel={`Choose colleague for participant ${index + 1}`} disabled={busy} onPress={() => { setSelectingId(row.id); setSearch(''); }} style={styles.close}><UserRound size={22} color={colors.blue} /></Pressable>}
            </View><Text numberOfLines={2} style={[styles.routeDetail, route.kind === 'internal' && styles.teamDetail]}>{detail}</Text>
          </View>;
        })}
        {participants.length < 5 && <Pressable accessibilityRole="button" accessibilityLabel="Add participant" disabled={busy} onPress={() => setParticipants((rows) => [...rows, newParticipant(rows.length)])} style={styles.add}><Plus size={17} color={colors.mint} /><Text style={styles.addText}>Add participant</Text></Pressable>}
        <View style={styles.preferences}>
          {hasExternal && !selectedCaller && <Text style={styles.note}>Ask your administrator to assign an outgoing line.</Text>}
          {directory.status === 'failed' && <Pressable accessibilityRole="button" accessibilityLabel="Retry company directory" onPress={directory.retry} style={styles.country}><RotateCw size={16} color={colors.blue} /><Text style={styles.note}>Retry directory</Text></Pressable>}
        </View>
        {(error || duplicate) && <Text accessibilityRole="alert" style={styles.error}>{error || 'Each participant can only be added once.'}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Start conference" accessibilityState={{ disabled: !valid || busy, busy }} disabled={!valid || busy} onPress={start} style={[styles.start, (!valid || busy) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.ink} /> : <><UsersRound size={20} color={colors.ink} /><Text style={styles.startText}>Start conference</Text></>}</Pressable>
      </>}
    </ScrollView>

    <Modal visible={Boolean(selectingId)} transparent animationType="slide" onRequestClose={() => setSelectingId(null)}>
      <View style={styles.modalBackdrop}><View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>COMPANY DIRECTORY</Text><Text style={styles.modalTitle}>Choose a colleague</Text></View><Pressable accessibilityLabel="Close directory" onPress={() => setSelectingId(null)} style={styles.close}><X size={20} color={colors.text} /></Pressable></View>
        <View style={styles.search}><Search size={18} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} autoCorrect={false} placeholder="Search name or extension" placeholderTextColor={colors.textFaint} style={styles.searchInput} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.directoryList}>
          {loadingDirectory ? <ActivityIndicator color={colors.mint} /> : filteredDirectory.map((user) => <Pressable key={user.id} accessibilityRole="button" accessibilityLabel={`Choose ${user.name}`} onPress={() => { if (selectingId) update(selectingId, { number: user.extension }); setSelectingId(null); }} style={styles.directoryRow}><View style={styles.directoryAvatar}><Text style={styles.directoryInitial}>{user.name.slice(0, 1).toUpperCase()}</Text></View><PresenceDot presence={user.presence} /><View style={styles.directoryCopy}><Text style={styles.directoryName}>{user.name}</Text><Text style={styles.directoryMeta}>Extension {user.extension}{user.department ? ` · ${user.department}` : ''}</Text></View></Pressable>)}
          {!loadingDirectory && !filteredDirectory.length && <Text style={styles.empty}>{directory.status === 'failed' ? 'Company directory unavailable' : 'No matching colleagues'}</Text>}
          {directory.status === 'failed' && <Pressable accessibilityRole="button" onPress={directory.retry} style={styles.add}><RotateCw size={18} color={colors.blue} /><Text style={styles.addText}>Retry</Text></Pressable>}
        </ScrollView>
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 32 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageTitle: { flex: 1, color: colors.text, fontSize: 21, fontWeight: '700' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  participantsHeading: { marginTop: 30, marginBottom: 10, color: colors.text, fontSize: 17, fontWeight: '600' },
  participant: { paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line },
  participantTop: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  participantName: { flex: 1, color: colors.textMuted, fontSize: 12 },
  numberRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  numberInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 21, fontVariant: ['tabular-nums'] },
  routeDetail: { minHeight: 36, paddingTop: 6, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  teamDetail: { color: colors.mint },
  add: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8 },
  addText: { color: colors.mint, fontSize: 13, fontWeight: '600' },
  preferences: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  country: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.amber, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  start: { minHeight: 56, marginTop: 24, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.mint },
  startText: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  success: { flex: 1, paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: colors.text, fontSize: 21, fontWeight: '600', textAlign: 'center', marginTop: 16 },
  successText: { color: colors.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  secondary: { minHeight: 44, marginTop: 20, justifyContent: 'center' },
  secondaryText: { color: colors.mint, fontSize: 13, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { maxHeight: '80%', padding: 20, backgroundColor: colors.ink, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalEyebrow: { color: colors.textMuted, fontSize: 10 },
  modalTitle: { color: colors.text, fontSize: 21, fontWeight: '600', marginTop: 6 },
  search: { minHeight: 48, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16 },
  directoryList: { paddingVertical: 12 },
  directoryRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  directoryAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  directoryInitial: { color: colors.blue, fontSize: 16, fontWeight: '600' },
  directoryCopy: { flex: 1, minWidth: 0 },
  directoryName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  directoryMeta: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 24, fontSize: 13 },
});
