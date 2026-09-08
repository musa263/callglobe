import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Clock3, Pause, Phone, PhoneMissed, Play, Search, Trash2, Voicemail } from 'lucide-react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageHeading } from '../../../shared/components/PageHeading';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../../shared/api';
import type { CallLog, VoicemailMessage } from '../../../shared/types';
import { colors } from '../../../shared/theme';
import { canRedialHistory, normalizeHistoryIdentity } from '../engine/historyIdentity';

type Filter = 'all' | 'missed' | 'voicemail';

const relativeDate = (date: string) => {
  const value = new Date(date);
  const diff = Date.now() - value.getTime();
  if (diff < 86400000 && value.getDate() === new Date().getDate()) return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff < 7 * 86400000) return value.toLocaleDateString([], { weekday: 'short' });
  return value.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const duration = (seconds = 0) => seconds ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : 'No answer';

export function RecentsScreen({ onRedial }: { onRedial: (call: CallLog) => void }) {
  const insets = useSafeAreaInsets();
  const { history, refresh } = useAuth();
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const [filter, setFilter] = useState<Filter>('all');
  const [voicemails, setVoicemails] = useState<VoicemailMessage[]>([]);
  const [playingId, setPlayingId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const loadVoicemails = useCallback(async () => {
    const result = await api.get<{ voicemails: VoicemailMessage[] }>('/api/voice/voicemails');
    setVoicemails(result.voicemails ?? []);
  }, []);

  useEffect(() => { loadVoicemails().catch(() => undefined); }, [loadVoicemails]);

  const calls = useMemo(() => {
    const normalized = history.map((call) => normalizeHistoryIdentity(call));
    const filtered = filter === 'all' ? normalized : normalized.filter((call) => call.status !== 'completed');
    const needle = query.trim().toLowerCase();
    return needle ? filtered.filter((call) => `${call.destination_name || ''} ${call.destination_country || ''} ${call.destination_number}`.toLowerCase().includes(needle)) : filtered;
  }, [filter, history, query]);

  const visibleVoicemails = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? voicemails.filter((item) => `${item.callerName ?? ''} ${item.callerNumber}`.toLowerCase().includes(needle)) : voicemails;
  }, [query, voicemails]);

  const doRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadVoicemails().catch(() => undefined)]);
    setRefreshing(false);
  };

  const playVoicemail = async (item: VoicemailMessage) => {
    if (playingId === item.id && playerStatus.playing) {
      player.pause();
      return;
    }
    if (playingId === item.id) {
      player.play();
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
    player.replace(await api.audioSource(`/api/voice/voicemails?audio=1&id=${encodeURIComponent(item.id)}`));
    setPlayingId(item.id);
    player.play();
  };

  const removeVoicemail = (item: VoicemailMessage) => Alert.alert('Delete voicemail?', 'This recording will be removed from Vocivo.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      if (playingId === item.id) { player.pause(); setPlayingId(''); }
      await api.delete(`/api/voice/voicemails?id=${encodeURIComponent(item.id)}`);
      setVoicemails((current) => current.filter((message) => message.id !== item.id));
    } },
  ]);

  const empty = filter === 'voicemail'
    ? { title: 'No voicemail yet', body: 'Unanswered callers can leave a private recording when voicemail is enabled.' }
    : { title: 'No calls here yet', body: 'Your completed and missed calls will appear here.' };

  return (
    <View style={[styles.page, { paddingTop: Math.max(insets.top, 18) }]}>
      <View style={styles.header}>
        <PageHeading title="Recents" />
        <Pressable accessibilityLabel="Search activity" onPress={() => { setSearching((value) => !value); if (searching) setQuery(''); }} style={styles.search}><Search size={21} color={colors.textMuted} /></Pressable>
      </View>
      {searching && <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search name or number" placeholderTextColor={colors.textFaint} style={styles.searchInput} />}
      <View style={styles.segment}>
        {(['all', 'missed', 'voicemail'] as const).map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.segmentButton, filter === item && styles.segmentActive]}><Text style={[styles.segmentText, filter === item && styles.segmentTextActive]}>{item === 'all' ? 'All calls' : item === 'missed' ? 'Missed' : 'Voicemail'}</Text></Pressable>)}
      </View>
      {filter === 'voicemail' ? (
        <FlatList data={visibleVoicemails} keyExtractor={(item) => item.id} showsVerticalScrollIndicator={false} contentContainerStyle={visibleVoicemails.length ? styles.list : styles.emptyList} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={colors.blue} />} ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}><Voicemail size={30} color={colors.textFaint} /></View><Text style={styles.emptyTitle}>{empty.title}</Text><Text style={styles.emptyBody}>{empty.body}</Text></View>} renderItem={({ item }) => <View style={styles.row}><Pressable accessibilityLabel={playingId === item.id && playerStatus.playing ? 'Pause voicemail' : 'Play voicemail'} onPress={() => playVoicemail(item).catch((error) => Alert.alert('Playback unavailable', error instanceof Error ? error.message : 'The voicemail could not be played.'))} style={styles.play}>{playingId === item.id && playerStatus.playing ? <Pause size={18} color={colors.ink} fill={colors.ink} /> : <Play size={18} color={colors.ink} fill={colors.ink} />}</Pressable><View style={styles.details}><Text style={styles.destination}>{item.callerName || item.callerNumber}</Text><Text style={styles.meta}>{item.callerNumber} · {duration(item.durationSeconds)}</Text></View><View style={styles.right}><Text style={styles.time}>{relativeDate(item.createdAt)}</Text><Pressable accessibilityLabel="Delete voicemail" onPress={() => removeVoicemail(item)} style={styles.delete}><Trash2 size={16} color={colors.textFaint} /></Pressable></View></View>} />
      ) : (
        <FlatList data={calls} keyExtractor={(item) => item.id} showsVerticalScrollIndicator={false} contentContainerStyle={calls.length ? styles.list : styles.emptyList} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={colors.blue} />} ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}><Clock3 size={30} color={colors.textFaint} /></View><Text style={styles.emptyTitle}>{empty.title}</Text><Text style={styles.emptyBody}>{empty.body}</Text></View>} renderItem={({ item }) => {
          const missed = item.status !== 'completed';
          const meta = item.internal
            ? `${item.destination_number ? `Extension ${item.destination_number}` : 'Company extension'} · ${duration(item.duration_seconds)}`
            : `${item.destination_country ? `${item.destination_country} · ` : ''}${item.destination_number} · ${duration(item.duration_seconds)}`;
          return <Pressable accessibilityLabel={`Call ${item.destination_name || item.destination_number}`} disabled={!canRedialHistory(item)} onPress={() => onRedial(item)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}><View style={[styles.icon, missed && styles.iconMissed]}>{missed ? <PhoneMissed size={19} color={colors.coral} /> : <Phone size={19} color={colors.mint} />}</View><View style={styles.details}><Text style={styles.destination}>{item.destination_name || item.destination_number}</Text><Text style={styles.meta}>{meta}</Text></View><View style={styles.right}><Text style={styles.time}>{relativeDate(item.started_at)}</Text><Text style={styles.cost}>{item.total_cost ? `-$${item.total_cost.toFixed(2)}` : '—'}</Text></View></Pressable>;
        }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 20, backgroundColor: colors.ink },
  header: { minHeight: 74, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: '800' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 3 },
  search: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  searchInput: { height: 44, paddingHorizontal: 12, borderRadius: 8, color: colors.text, fontSize: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  segment: { height: 40, padding: 3, flexDirection: 'row', borderRadius: 8, backgroundColor: colors.panel, marginVertical: 12 },
  segmentButton: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.panelRaised },
  segmentText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  segmentTextActive: { color: colors.text },
  list: { paddingBottom: 28 },
  row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowPressed: { opacity: 0.65 },
  icon: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12334A', marginRight: 12 },
  iconMissed: { backgroundColor: '#281616' },
  play: { width: 42, height: 42, marginRight: 12, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue },
  details: { flex: 1 },
  destination: { color: colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 5 },
  right: { minWidth: 54, alignItems: 'flex-end', gap: 6 },
  time: { color: colors.textMuted, fontSize: 11 },
  cost: { color: colors.textFaint, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  delete: { width: 32, height: 28, alignItems: 'flex-end', justifyContent: 'center' },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 80 },
  emptyIcon: { width: 62, height: 62, borderRadius: 16, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
});
