import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Copy, Plus, Video } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, vocivoOrigin } from '../../../shared/api';
import { colors } from '../../../shared/theme';

type VideoSession = { roomId: string; token: string; participantName: string; participantPhotoUrl?: string };

export function VideoMeetingScreen({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [roomCode, setRoomCode] = useState('');
  const [session, setSession] = useState<VideoSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async (joinExisting: boolean) => {
    if (joinExisting && !/^[0-9a-f-]{36}$/i.test(roomCode.trim())) { setError('Enter the complete meeting code.'); return; }
    setBusy(true); setError('');
    try { setSession(await api.post<VideoSession>('/api/voice/video', joinExisting ? { roomId: roomCode.trim() } : {})); }
    catch (startError) { setError(startError instanceof Error ? startError.message : 'The video meeting could not start.'); }
    finally { setBusy(false); }
  };

  if (session) {
    const hash = new URLSearchParams({ room: session.roomId, token: session.token, name: session.participantName, photo: session.participantPhotoUrl || '' }).toString();
    return <View style={styles.page}><View style={[styles.meetingHeader, { paddingTop: Math.max(insets.top, 18) }]}><Pressable accessibilityLabel="Leave video meeting" onPress={onClose} style={styles.iconButton}><ArrowLeft size={21} color={colors.text} /></Pressable><View style={styles.meetingCopy}><Text style={styles.meetingLabel}>VIDEO MEETING</Text><Text numberOfLines={1} style={styles.meetingCode}>{session.roomId}</Text></View><Pressable accessibilityLabel="Copy meeting code" onPress={() => Clipboard.setStringAsync(session.roomId)} style={styles.iconButton}><Copy size={19} color={colors.mint} /></Pressable></View><WebView source={{ uri: `${vocivoOrigin}/video.html#${hash}` }} style={styles.webview} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled onMessage={(event) => { try { if (JSON.parse(event.nativeEvent.data)?.type === 'leave') onClose(); } catch { /* Ignore non-Vocivo messages. */ } }} /></View>;
  }

  return <View style={[styles.page, styles.lobby, { paddingTop: Math.max(insets.top, 22) }]}><View style={styles.lobbyHeader}><Pressable accessibilityLabel="Close video" onPress={onClose} style={styles.iconButton}><ArrowLeft size={21} color={colors.text} /></Pressable><Text style={styles.lobbyHeaderText}>Vocivo Video</Text><View style={styles.iconButton} /></View><View style={styles.hero}><View style={styles.videoIcon}><Video size={34} color={colors.mint} /></View><Text style={styles.title}>Meet face to face</Text><Text style={styles.subtitle}>Start a secure company video room or join a colleague with their meeting code.</Text></View><Pressable disabled={busy} onPress={() => start(false)} style={styles.create}>{busy ? <ActivityIndicator color={colors.ink} /> : <><Plus size={20} color={colors.ink} /><Text style={styles.createText}>Start new meeting</Text></>}</Pressable><View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR JOIN</Text><View style={styles.dividerLine} /></View><TextInput value={roomCode} onChangeText={setRoomCode} autoCapitalize="none" autoCorrect={false} placeholder="Paste meeting code" placeholderTextColor={colors.textFaint} style={styles.input} /><Pressable disabled={busy || !roomCode.trim()} onPress={() => start(true)} style={[styles.join, (!roomCode.trim() || busy) && styles.disabled]}><Text style={styles.joinText}>Join meeting</Text></Pressable>{!!error && <Text style={styles.error}>{error}</Text>}</View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink }, webview: { flex: 1, backgroundColor: colors.ink },
  meetingHeader: { minHeight: 76, paddingHorizontal: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.canvas, borderBottomWidth: 1, borderBottomColor: colors.line }, iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, meetingCopy: { flex: 1, minWidth: 0 }, meetingLabel: { color: colors.mint, fontSize: 8, fontWeight: '900' }, meetingCode: { color: colors.textMuted, fontSize: 9, marginTop: 4 },
  lobby: { paddingHorizontal: 22 }, lobbyHeader: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, lobbyHeaderText: { color: colors.text, fontSize: 15, fontWeight: '900' }, hero: { alignItems: 'center', paddingTop: 62, paddingBottom: 42 }, videoIcon: { width: 74, height: 74, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12334A', borderWidth: 1, borderColor: '#2B6282' }, title: { color: colors.text, fontSize: 28, fontWeight: '900', marginTop: 20 }, subtitle: { maxWidth: 330, color: colors.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 }, create: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, backgroundColor: colors.mint }, createText: { color: colors.ink, fontSize: 14, fontWeight: '900' }, divider: { height: 54, flexDirection: 'row', alignItems: 'center', gap: 10 }, dividerLine: { flex: 1, height: 1, backgroundColor: colors.line }, dividerText: { color: colors.textFaint, fontSize: 9, fontWeight: '900' }, input: { height: 52, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: colors.line, color: colors.text, backgroundColor: colors.panel }, join: { height: 50, marginTop: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.blue, backgroundColor: '#102842' }, joinText: { color: colors.blue, fontSize: 14, fontWeight: '900' }, disabled: { opacity: 0.35 }, error: { color: colors.coral, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 12 },
});
