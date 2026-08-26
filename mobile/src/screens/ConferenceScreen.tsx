import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Building2, ChevronDown, Globe2, Minus, PhoneCall, Plus, Search, UserRound, UsersRound, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '../components/BrandMark';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { colors } from '../theme';

type DirectoryUser = { id: string; extension: string; name: string; department: string; sipUsername: string; photoUrl?: string };
type Participant = { id: string; type: 'external' | 'extension'; number: string; extensionId: string };

const clean = (value: string) => value.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '').slice(0, 16);
const newParticipant = (index: number): Participant => ({ id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`, type: 'external', number: '', extensionId: '' });

export function ConferenceScreen({ onDirect, onWallet }: { onDirect: () => void; onWallet: () => void }) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>(() => [newParticipant(0), newParticipant(1)]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const businessAccount = profile?.account_type === 'business' && Boolean(profile.extension);

  useEffect(() => {
    if (!businessAccount) return;
    setLoadingDirectory(true);
    api.get<{ users: DirectoryUser[] }>('/api/voice/directory')
      .then(({ users }) => setDirectory(users.filter((user) => user.id !== profile?.id && user.extension !== profile?.extension)))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'The company directory is unavailable.'))
      .finally(() => setLoadingDirectory(false));
  }, [businessAccount, profile?.extension, profile?.id]);

  const update = (id: string, patch: Partial<Participant>) => setParticipants((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  const selectedUser = (row: Participant) => directory.find((user) => user.id === row.extensionId);
  const values = participants.map((row) => row.type === 'extension' ? `ext:${row.extensionId}` : clean(row.number));
  const valid = participants.length >= 2
    && participants.every((row) => row.type === 'extension' ? Boolean(selectedUser(row)) : /^\+[1-9]\d{6,14}$/.test(clean(row.number)))
    && new Set(values).size === values.length;
  const filteredDirectory = useMemo(() => {
    const query = search.trim().toLowerCase();
    return directory.filter((user) => !query || `${user.name} ${user.extension} ${user.department}`.toLowerCase().includes(query));
  }, [directory, search]);

  const chooseType = (row: Participant, type: Participant['type']) => {
    setError('');
    update(row.id, { type, number: '', extensionId: '' });
    if (type === 'extension') {
      setSelectingId(row.id);
      setSearch('');
    }
  };

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/api/voice/conferences', {
        participants: participants.map((row) => row.type === 'extension'
          ? { type: 'extension', extensionId: row.extensionId }
          : { type: 'external', number: clean(row.number) }),
      });
      setStarted(true);
    } catch (conferenceError) {
      setError(conferenceError instanceof Error ? conferenceError.message : 'The conference could not be started.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) }]} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><BrandMark compact /><Pressable onPress={onWallet} style={styles.balance}><Text style={styles.balanceText}>Balance</Text><Plus size={15} color={colors.mint} /></Pressable></View>
      <View style={styles.mode}><Pressable onPress={onDirect} style={styles.modeButton}><Text style={styles.modeText}>Direct call</Text></Pressable><View style={[styles.modeButton, styles.modeActive]}><Text style={styles.modeActiveText}>Conference</Text></View></View>
      <View style={styles.intro}><View style={styles.icon}><UsersRound size={28} color={colors.mint} /></View><Text style={styles.title}>Merged conference</Text><Text style={styles.subtitle}>Bring colleagues and international numbers into one live room. Internal extension legs stay on your company network.</Text></View>
      {started ? <View style={styles.success}><PhoneCall size={26} color={colors.mint} /><Text style={styles.successTitle}>Answer the host call</Text><Text style={styles.successText}>Vocivo will join each participant after you answer.</Text><Pressable onPress={() => setStarted(false)} style={styles.secondary}><Text style={styles.secondaryText}>Start another conference</Text></Pressable></View> : <>
        <Text style={styles.label}>PARTICIPANTS</Text>
        {participants.map((row, index) => {
          const colleague = selectedUser(row);
          return <View key={row.id} style={styles.participant}>
            <View style={styles.participantTop}>
              <View style={styles.position}><Text style={styles.positionText}>{index + 1}</Text></View>
              <View style={styles.kindControl}>
                <Pressable onPress={() => chooseType(row, 'external')} style={[styles.kindButton, row.type === 'external' && styles.kindActive]}><Globe2 size={13} color={row.type === 'external' ? colors.ink : colors.textMuted} /><Text style={row.type === 'external' ? styles.kindActiveText : styles.kindText}>External</Text></Pressable>
                {businessAccount && <Pressable onPress={() => chooseType(row, 'extension')} style={[styles.kindButton, row.type === 'extension' && styles.kindActive]}><Building2 size={13} color={row.type === 'extension' ? colors.ink : colors.textMuted} /><Text style={row.type === 'extension' ? styles.kindActiveText : styles.kindText}>Extension</Text></Pressable>}
              </View>
              {participants.length > 2 && <Pressable accessibilityLabel="Remove participant" onPress={() => setParticipants((rows) => rows.filter((candidate) => candidate.id !== row.id))} style={styles.remove}><Minus size={18} color={colors.coral} /></Pressable>}
            </View>
            {row.type === 'external'
              ? <TextInput value={row.number} onChangeText={(number) => update(row.id, { number: clean(number) })} placeholder="+234..." placeholderTextColor={colors.textFaint} keyboardType="phone-pad" autoCorrect={false} style={styles.input} />
              : <Pressable onPress={() => { setSelectingId(row.id); setSearch(''); }} style={styles.extensionPicker}><View style={styles.extensionAvatar}><UserRound size={17} color={colors.mint} /></View><View style={styles.extensionCopy}><Text numberOfLines={1} style={[styles.extensionName, !colleague && styles.placeholder]}>{colleague?.name || 'Choose a colleague'}</Text>{colleague && <Text style={styles.extensionMeta}>Extension {colleague.extension} · {colleague.department}</Text>}</View><ChevronDown size={18} color={colors.textMuted} /></Pressable>}
          </View>;
        })}
        {participants.length < 5 && <Pressable onPress={() => setParticipants((rows) => [...rows, newParticipant(rows.length)])} style={styles.add}><Plus size={17} color={colors.mint} /><Text style={styles.addText}>Add participant</Text></Pressable>}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={!valid || busy} onPress={start} style={[styles.start, (!valid || busy) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.ink} /> : <><UsersRound size={20} color={colors.ink} /><Text style={styles.startText}>Start merged conference</Text></>}</Pressable>
        <Text style={styles.note}>External legs use the assigned company caller ID and standard calling rates. Internal extension legs do not require a phone number.</Text>
      </>}
    </ScrollView>

    <Modal visible={Boolean(selectingId)} transparent animationType="slide" onRequestClose={() => setSelectingId(null)}>
      <View style={styles.modalBackdrop}><View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>COMPANY DIRECTORY</Text><Text style={styles.modalTitle}>Choose a colleague</Text></View><Pressable accessibilityLabel="Close directory" onPress={() => setSelectingId(null)} style={styles.close}><X size={20} color={colors.text} /></Pressable></View>
        <View style={styles.search}><Search size={18} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} autoCorrect={false} placeholder="Search name or extension" placeholderTextColor={colors.textFaint} style={styles.searchInput} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.directoryList}>
          {loadingDirectory ? <ActivityIndicator color={colors.mint} /> : filteredDirectory.map((user) => <Pressable key={user.id} onPress={() => { if (selectingId) update(selectingId, { extensionId: user.id }); setSelectingId(null); }} style={styles.directoryRow}><View style={styles.directoryAvatar}><Text style={styles.directoryInitial}>{user.name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.directoryCopy}><Text style={styles.directoryName}>{user.name}</Text><Text style={styles.directoryMeta}>Extension {user.extension} · {user.department}</Text></View></Pressable>)}
          {!loadingDirectory && !filteredDirectory.length && <Text style={styles.empty}>No matching colleagues are available.</Text>}
        </ScrollView>
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink }, content: { minHeight: '100%', paddingHorizontal: 20, paddingBottom: 36 }, header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, balance: { height: 36, paddingHorizontal: 11, borderRadius: 8, flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }, balanceText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' }, mode: { height: 42, padding: 3, marginTop: 12, flexDirection: 'row', backgroundColor: colors.panel, borderRadius: 8 }, modeButton: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, modeActive: { backgroundColor: colors.panelRaised }, modeText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' }, modeActiveText: { color: colors.mint, fontSize: 12, fontWeight: '800' }, intro: { alignItems: 'center', paddingVertical: 24 }, icon: { width: 58, height: 58, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12334A' }, title: { color: colors.text, fontSize: 23, fontWeight: '800', marginTop: 14 }, subtitle: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8, maxWidth: 340 }, label: { color: colors.textFaint, fontSize: 10, fontWeight: '900', marginBottom: 7 }, participant: { marginBottom: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel }, participantTop: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8 }, position: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelRaised }, positionText: { color: colors.textMuted, fontSize: 11, fontWeight: '900' }, kindControl: { flex: 1, height: 30, padding: 2, flexDirection: 'row', borderRadius: 7, backgroundColor: colors.ink }, kindButton: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 5 }, kindActive: { backgroundColor: colors.mint }, kindText: { color: colors.textMuted, fontSize: 10, fontWeight: '800' }, kindActiveText: { color: colors.ink, fontSize: 10, fontWeight: '900' }, remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, input: { height: 46, marginTop: 7, paddingHorizontal: 9, color: colors.text, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'], borderTopWidth: 1, borderTopColor: colors.line }, extensionPicker: { minHeight: 52, marginTop: 7, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderTopColor: colors.line }, extensionAvatar: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelRaised }, extensionCopy: { flex: 1, minWidth: 0 }, extensionName: { color: colors.text, fontSize: 13, fontWeight: '800' }, extensionMeta: { color: colors.textMuted, fontSize: 10, marginTop: 3 }, placeholder: { color: colors.textFaint }, add: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 8 }, addText: { color: colors.mint, fontSize: 12, fontWeight: '800' }, error: { color: colors.coral, textAlign: 'center', fontSize: 11, marginTop: 8 }, start: { height: 52, marginTop: 16, borderRadius: 8, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint }, disabled: { opacity: 0.3 }, startText: { color: colors.ink, fontSize: 14, fontWeight: '900' }, note: { color: colors.textFaint, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10 }, success: { minHeight: 240, padding: 24, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, successTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 15 }, successText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 7 }, secondary: { height: 42, marginTop: 22, paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center', backgroundColor: colors.panelRaised }, secondaryText: { color: colors.mint, fontSize: 11, fontWeight: '800' }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2, 13, 27, 0.72)' }, modalSheet: { maxHeight: '78%', padding: 20, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: colors.ink, borderTopWidth: 1, borderColor: colors.line }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalEyebrow: { color: colors.mint, fontSize: 9, fontWeight: '900' }, modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 4 }, close: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel }, search: { height: 48, marginTop: 18, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel }, searchInput: { flex: 1, color: colors.text, fontSize: 14 }, directoryList: { paddingVertical: 10 }, directoryRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: colors.line }, directoryAvatar: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12334A' }, directoryInitial: { color: colors.mint, fontSize: 15, fontWeight: '900' }, directoryCopy: { flex: 1, minWidth: 0 }, directoryName: { color: colors.text, fontSize: 13, fontWeight: '800' }, directoryMeta: { color: colors.textMuted, fontSize: 10, marginTop: 3 }, empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 30, fontSize: 12 },
});
