import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeftRight, Check, ChevronDown, Delete, Grid3X3, Merge, Mic, MicOff, Pause, Phone, PhoneForwarded, PhoneOff, Play, UserMinus, UserPlus, Volume2, VolumeX, X } from 'lucide-react-native';
import { useLocales } from 'expo-localization';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keypad } from '../components/Keypad';
import { useVoice } from '../VoiceContext';
import { useAuth } from '../../auth/AuthContext';
import { RatePicker } from '../components/RatePicker';
import type { CallerNumber, CallRate } from '../../../shared/types';
import { colors, shadow } from '../../../shared/theme';
import { api } from '../../../shared/api';
import { findPhoneContact } from '../../contacts/contactDirectory';
import { cleanDialInput, defaultDialRegion, dialRegion, resolveDialNumber } from '../state/dialNumber';

const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

function Control({ label, active, disabled, onPress, children }: { label: string; active?: boolean; disabled?: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.controlWrap, disabled && styles.controlDisabled, pressed && styles.pressed]}>
      <View style={[styles.control, active && styles.controlActive]}>{children}</View>
      <Text style={[styles.controlLabel, active && styles.controlLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function AddCallModal({ visible, rates, caller, onClose, onStart }: { visible: boolean; rates: CallRate[]; caller?: CallerNumber; onClose: () => void; onStart: (number: string, rate: CallRate, caller?: CallerNumber) => Promise<void> }) {
  const locales = useLocales();
  const [regionOverride, setRegionOverride] = useState<string>();
  const region = dialRegion(regionOverride) || defaultDialRegion(locales[0]?.regionCode);
  const [number, setNumber] = useState('');
  const destination = resolveDialNumber(number, region, rates);
  const selected = rates.find((rate) => rate.country_code === region);
  const [showRates, setShowRates] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');

  const start = async () => {
    if (!destination.valid || busyRef.current) return;
    if (!caller?.phone_number) {
      setError('Choose a caller ID before adding an external caller.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onStart(destination.number, destination.rate, caller);
      setNumber('');
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'The second call could not be started.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.addModal}>
        <View style={styles.addHeader}><View><Text style={styles.addEyebrow}>MULTI-CALL</Text><Text style={styles.addTitle}>Add another caller</Text></View><Pressable accessibilityLabel="Close add call" onPress={onClose} style={styles.addClose}><X size={21} color={colors.text} /></Pressable></View>
        <Pressable accessibilityLabel="Choose default country for local numbers" onPress={() => setShowRates(true)} style={styles.addCountry}><Text style={styles.addCountryName}>{selected?.country_name || 'Choose country'}</Text><ChevronDown size={18} color={colors.textMuted} /></Pressable>
        <View style={styles.addNumber}><TextInput accessibilityLabel="Second caller phone number" value={number} onChangeText={(value) => setNumber(cleanDialInput(value))} keyboardType="phone-pad" showSoftInputOnFocus={false} placeholder="Phone number" placeholderTextColor={colors.textFaint} style={styles.addDigits} /><Pressable accessibilityLabel="Delete last digit" onPress={() => setNumber((value) => value.slice(0, -1))} onLongPress={() => setNumber('')} style={styles.addDelete}><Delete size={21} color={colors.textMuted} /></Pressable></View>
        <Text style={styles.addRate}>{destination.valid ? destination.formatted : ' '}</Text>
        {!!error && <Text style={styles.addError}>{error}</Text>}
        <View style={styles.addKeypad}><Keypad plain onPress={(digit) => setNumber((value) => cleanDialInput(value + digit))} onPlus={() => setNumber((value) => `+${value.replace(/^\+/, '')}`)} /></View>
        <Pressable disabled={!destination.valid || busy} onPress={start} style={[styles.addButton, (!destination.valid || busy) && styles.addButtonDisabled]}>{busy ? <Text style={styles.addButtonText}>Calling...</Text> : <><Phone size={21} color={colors.ink} fill={colors.ink} /><Text style={styles.addButtonText}>Hold and call</Text></>}</Pressable>
        <RatePicker visible={showRates} rates={rates} selected={selected} onSelect={(rate) => setRegionOverride(rate.country_code)} onClose={() => setShowRates(false)} />
      </View>
    </Modal>
  );
}

export function ActiveCallScreen({ onMinimize }: { onMinimize: () => void }) {
  const insets = useSafeAreaInsets();
  const { rates, callerNumbers, profile } = useAuth();
  const { activeCall, waitingCall, heldCall, conference, duration, error: voiceError, endCall, answerCall, toggleMute, toggleHold, toggleSpeaker, sendDtmf, startSecondCall, transferCall, answerWaitingCall, rejectWaitingCall, swapCalls, mergeCalls, removeConferenceParticipant } = useVoice();
  const [showKeypad, setShowKeypad] = useState(false);
  const [showAddCall, setShowAddCall] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [team, setTeam] = useState<Array<{ id: string; extension: string; name: string; department: string; photoUrl?: string }>>([]);
  const [remotePhoto, setRemotePhoto] = useState<string | undefined>();
  const [transferBusy, setTransferBusy] = useState('');
  const [transferError, setTransferError] = useState('');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [swapBusy, setSwapBusy] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [removingParticipant, setRemovingParticipant] = useState('');
  const [endingCall, setEndingCall] = useState(false);
  useEffect(() => {
    if (!activeCall) { setRemotePhoto(undefined); return; }
    if (activeCall.photoUrl) { setRemotePhoto(activeCall.photoUrl); return; }
    const lookup = activeCall.destinationCountry === 'Internal'
      ? api.get<{ users: Array<{ extension: string; name: string; photoUrl?: string }> }>('/api/voice/directory').then(({ users }) => {
        const match = users.find((user) => user.extension === activeCall.number.replace(/\D/g, '') || user.name.toLowerCase() === activeCall.displayName.toLowerCase());
        return match ? { name: match.name, photoUrl: match.photoUrl } : null;
      })
      : findPhoneContact(activeCall.number);
    let stale = false;
    lookup.then((identity) => { if (!stale) setRemotePhoto(identity?.photoUrl); }).catch(() => { if (!stale) setRemotePhoto(undefined); });
    return () => { stale = true; };
  }, [activeCall?.displayName, activeCall?.number, activeCall?.photoUrl]);
  if (!activeCall) return null;
  const incomingPending = Boolean(activeCall.isIncoming && ['ringing', 'connecting'].includes(activeCall.phase));
  const status = activeCall.phase === 'active'
    ? (activeCall.onHold ? 'On hold' : 'Connected')
    : activeCall.phase === 'ended'
      ? 'Call ended'
      : activeCall.phase === 'failed'
        ? 'Could not connect'
        : activeCall.isIncoming
          ? (activeCall.phase === 'connecting' ? 'Answering' : 'Ringing')
          : 'Calling';
  const extensionNumber = activeCall.number.replace(/\D/g, '');
  const visibleNumber = activeCall.destinationCountry === 'Internal' ? (extensionNumber ? `Extension ${extensionNumber}` : 'Internal call') : activeCall.number;
  const businessAccount = profile?.account_type === 'business';
  const transferEnabled = Boolean(businessAccount && profile?.extension && activeCall.isIncoming && activeCall.phase === 'active' && !conference);
  const selectedCaller = callerNumbers.find((number) => number.phone_number === activeCall.callerId)
    ?? callerNumbers.find((number) => number.source === 'owned' && number.status === 'active')
    ?? callerNumbers[0];

  const openTransfer = async () => {
    setShowTransfer(true); setTransferError('');
    try { const result = await api.get<{ users: Array<{ id: string; extension: string; name: string; department: string; photoUrl?: string }> }>('/api/voice/directory'); setTeam(result.users.filter((user) => user.id !== profile?.id)); }
    catch (loadError) { setTransferError(loadError instanceof Error ? loadError.message : 'The company directory is unavailable.'); }
  };
  const sendTransfer = async (target: { id: string; name: string }) => {
    setTransferBusy(target.id); setTransferError('');
    try { await transferCall(target.id); setShowTransfer(false); }
    catch (transferFailure) { setTransferError(transferFailure instanceof Error ? transferFailure.message : 'The call could not be transferred.'); }
    finally { setTransferBusy(''); }
  };
  const hangup = async () => {
    if (endingCall) return;
    setEndingCall(true);
    try { await endCall(); }
    finally { setEndingCall(false); }
  };
  const merge = async () => {
    if (!heldCall || mergeBusy || conference) return;
    setMergeBusy(true); setMergeError('');
    try { await mergeCalls(); }
    catch (mergeFailure) { setMergeError(mergeFailure instanceof Error ? mergeFailure.message : 'The calls could not be merged.'); }
    finally { setMergeBusy(false); }
  };
  const swap = async () => {
    if (!heldCall || swapBusy || conference) return;
    setSwapBusy(true); setMergeError('');
    try { await swapCalls(); }
    catch (swapFailure) { setMergeError(swapFailure instanceof Error ? swapFailure.message : 'The calls could not be swapped.'); }
    finally { setSwapBusy(false); }
  };
  const acceptIncoming = async () => {
    if (answerBusy) return;
    setAnswerBusy(true); setMergeError('');
    try { await answerCall(); }
    catch (answerFailure) { setMergeError(answerFailure instanceof Error ? answerFailure.message : 'The call could not be answered.'); }
    finally { setAnswerBusy(false); }
  };
  const removeParticipant = async (participantId: string) => {
    if (removingParticipant) return;
    setRemovingParticipant(participantId); setMergeError('');
    try { await removeConferenceParticipant(participantId); }
    catch (removeFailure) { setMergeError(removeFailure instanceof Error ? removeFailure.message : 'The participant could not be removed.'); }
    finally { setRemovingParticipant(''); }
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.top, { paddingTop: Math.max(insets.top, 18) }]}>
        <Pressable accessibilityLabel="Minimize call" onPress={onMinimize} style={styles.minimize}><ChevronDown size={24} color={colors.textMuted} /></Pressable>
        <View style={styles.secure}><View style={styles.secureDot} /><Text style={styles.secureText}>VOCIVO VOICE</Text></View>
        <View style={styles.minimize} />
      </View>

      <View style={styles.identity}>
        {waitingCall && <View style={styles.waiting}><View style={styles.waitingCopy}><Text style={styles.waitingLabel}>INCOMING CALL WAITING</Text><Text numberOfLines={1} style={styles.waitingNumber}>{waitingCall.displayName || waitingCall.number}</Text></View><Pressable accessibilityLabel="Decline waiting call" onPress={rejectWaitingCall} style={styles.decline}><PhoneOff size={18} color={colors.white} /></Pressable><Pressable accessibilityLabel="Answer waiting call" onPress={answerWaitingCall} style={styles.answer}><Phone size={18} color={colors.ink} fill={colors.ink} /></Pressable></View>}
        <View style={styles.avatarOuter}>
          {remotePhoto ? <Image source={{ uri: remotePhoto }} style={styles.avatarPhoto} /> : <View style={styles.avatar}><Text style={styles.avatarInitials}>{activeCall.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '#'}</Text></View>}
        </View>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.name}>{activeCall.displayName}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.number}>{visibleNumber}</Text>
        <Text style={[styles.status, activeCall.phase === 'active' && styles.statusLive]}>{status}</Text>
        {activeCall.phase === 'active' && activeCall.connectedAt ? <Text style={styles.timer}>{formatTime(duration)}</Text> : null}
        {activeCall.ratePerMinute ? <Text style={styles.rate}>${activeCall.ratePerMinute.toFixed(3)} per minute</Text> : null}
        {conference ? <Pressable accessibilityRole="button" accessibilityLabel="Manage conference participants" onPress={() => setShowParticipants(true)} style={styles.conference}><View style={styles.conferenceIcon}><Merge size={15} color={colors.ink} /></View><View style={styles.conferenceCopy}><Text style={styles.conferenceLabel}>MERGED CONFERENCE</Text><Text numberOfLines={1} style={styles.conferenceNames}>{conference.participants.map((participant) => participant.displayName || participant.number).join(' + ')}</Text></View><View style={styles.liveBadge}><Text style={styles.liveBadgeText}>MANAGE</Text></View></Pressable> : heldCall ? <View style={styles.held}><View style={styles.heldCheck}><Check size={13} color={colors.mint} /></View><Text numberOfLines={1} style={styles.heldText}>{heldCall.displayName || heldCall.number} is on hold</Text><Pressable disabled={swapBusy} onPress={swap} style={styles.swapButton}><Text style={styles.swapText}>{swapBusy ? 'Wait' : 'Swap'}</Text></Pressable></View> : null}
        {!!mergeError && <Text style={styles.mergeError}>{mergeError}</Text>}
        {!!voiceError && <Text style={styles.mergeError}>{voiceError}</Text>}
      </View>

      {incomingPending ? <View style={[styles.incomingActions, { paddingBottom: Math.max(insets.bottom + 28, 42) }]}>
        <Pressable accessibilityLabel="Decline incoming call" disabled={answerBusy || endingCall} onPress={hangup} style={({ pressed }) => [styles.incomingAction, styles.incomingDecline, pressed && styles.endPressed]}><PhoneOff size={29} color={colors.white} /><Text style={styles.incomingActionLabel}>Decline</Text></Pressable>
        <Pressable accessibilityLabel="Answer incoming call" disabled={answerBusy} onPress={acceptIncoming} style={({ pressed }) => [styles.incomingAction, styles.incomingAccept, pressed && styles.endPressed]}>{answerBusy ? <ActivityIndicator color={colors.ink} /> : <Phone size={29} color={colors.ink} fill={colors.ink} />}<Text style={[styles.incomingActionLabel, styles.incomingAcceptLabel]}>{answerBusy ? 'Answering' : 'Answer'}</Text></Pressable>
      </View> : <View style={[styles.controlsSection, { paddingBottom: Math.max(insets.bottom + 20, 34) }]}>
        <View style={styles.controlsRow}>
          <Control label="Mute" active={activeCall.muted} onPress={toggleMute}>{activeCall.muted ? <MicOff size={24} color={colors.ink} /> : <Mic size={24} color={colors.text} />}</Control>
          <Control label="Keypad" onPress={() => setShowKeypad(true)}><Grid3X3 size={24} color={colors.text} /></Control>
          <Control label="Speaker" active={activeCall.speaker} onPress={toggleSpeaker}>{activeCall.speaker ? <Volume2 size={25} color={colors.ink} /> : <VolumeX size={25} color={colors.text} />}</Control>
          <Control label="Add caller" disabled={Boolean(conference) || Boolean(heldCall) || activeCall.phase !== 'active'} onPress={() => setShowAddCall(true)}><UserPlus size={24} color={conference || heldCall || activeCall.phase !== 'active' ? colors.textFaint : colors.text} /></Control>
          <Control label={activeCall.onHold ? 'Resume' : 'Hold'} active={activeCall.onHold} disabled={Boolean(conference)} onPress={toggleHold}>{activeCall.onHold ? <Play size={24} color={colors.ink} fill={colors.ink} /> : <Pause size={24} color={conference ? colors.textFaint : colors.text} />}</Control>
          <Control label={swapBusy ? 'Swapping' : 'Swap'} active={!!heldCall && activeCall.phase === 'active'} disabled={!heldCall || activeCall.phase !== 'active' || Boolean(conference) || swapBusy} onPress={swap}>{swapBusy ? <ActivityIndicator size="small" color={colors.text} /> : <ArrowLeftRight size={24} color={heldCall && activeCall.phase === 'active' ? colors.ink : colors.textFaint} />}</Control>
          <Control label={mergeBusy ? 'Merging' : conference ? 'Merged' : 'Merge'} active={Boolean(conference)} disabled={!heldCall?.routeId || !activeCall.routeId || activeCall.phase !== 'active' || mergeBusy || Boolean(conference)} onPress={merge}>{mergeBusy ? <ActivityIndicator size="small" color={colors.text} /> : <Merge size={24} color={conference ? colors.ink : heldCall?.routeId && activeCall.routeId && activeCall.phase === 'active' ? colors.text : colors.textFaint} />}</Control>
          {businessAccount && <Control label="Transfer" disabled={!transferEnabled} onPress={openTransfer}><PhoneForwarded size={24} color={transferEnabled ? colors.text : colors.textFaint} /></Control>}
        </View>
        <Pressable accessibilityLabel="End call" disabled={endingCall} onPress={hangup} style={({ pressed }) => [styles.end, pressed && styles.endPressed]}>{endingCall ? <ActivityIndicator color={colors.white} /> : <PhoneOff size={30} color={colors.white} strokeWidth={2.4} />}</Pressable>
      </View>}

      <Modal visible={showKeypad} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowKeypad(false)}>
        <View style={[styles.keypadModal, { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.keypadHeader}><Text style={styles.keypadTitle}>Keypad</Text><Pressable onPress={() => setShowKeypad(false)} style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable></View>
          <Text style={styles.keypadNumber}>{visibleNumber}</Text>
          <View style={styles.keypadBody}><Keypad compact onPress={sendDtmf} /></View>
        </View>
      </Modal>
      <AddCallModal visible={showAddCall} rates={rates} caller={selectedCaller} onClose={() => setShowAddCall(false)} onStart={startSecondCall} />
      <Modal visible={showTransfer} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTransfer(false)}>
        <View style={styles.transferPage}><View style={styles.addHeader}><View><Text style={styles.addEyebrow}>BUSINESS CALL</Text><Text style={styles.addTitle}>Transfer to colleague</Text></View><Pressable accessibilityLabel="Close transfer" onPress={() => setShowTransfer(false)} style={styles.addClose}><X size={21} color={colors.text} /></Pressable></View><Text style={styles.transferHelp}>The caller will be connected directly to the selected extension.</Text>{!!transferError && <Text style={styles.transferError}>{transferError}</Text>}<ScrollView style={styles.transferList}>{team.map((member) => <Pressable key={member.id} disabled={!!transferBusy} onPress={() => sendTransfer(member)} style={({ pressed }) => [styles.transferRow, pressed && styles.pressed]}>{member.photoUrl ? <Image source={{ uri: member.photoUrl }} style={styles.transferPhoto} /> : <View style={styles.transferAvatar}><Text style={styles.transferInitial}>{member.name.charAt(0).toUpperCase()}</Text></View>}<View style={styles.transferCopy}><Text style={styles.transferName}>{member.name}</Text><Text style={styles.transferMeta}>Extension {member.extension} · {member.department}</Text></View>{transferBusy === member.id ? <ActivityIndicator color={colors.mint} /> : <PhoneForwarded size={19} color={colors.mint} />}</Pressable>)}</ScrollView></View>
      </Modal>
      <Modal visible={showParticipants} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowParticipants(false)}>
        <View style={styles.transferPage}><View style={styles.addHeader}><View><Text style={styles.addEyebrow}>LIVE CONFERENCE</Text><Text style={styles.addTitle}>Participants</Text></View><Pressable accessibilityLabel="Close participants" onPress={() => setShowParticipants(false)} style={styles.addClose}><X size={21} color={colors.text} /></Pressable></View><Text style={styles.transferHelp}>The primary caller stays connected. Added participants can be removed individually.</Text><ScrollView style={styles.transferList}>{conference?.participants.map((participant, index) => <View key={participant.id || `${participant.number}-${index}`} style={styles.transferRow}>{participant.photoUrl ? <Image source={{ uri: participant.photoUrl }} style={styles.transferPhoto} /> : <View style={styles.transferAvatar}><Text style={styles.transferInitial}>{(participant.displayName || participant.number).charAt(0).toUpperCase()}</Text></View>}<View style={styles.transferCopy}><Text style={styles.transferName}>{participant.displayName || participant.number}</Text><Text style={styles.transferMeta}>{index === 0 ? 'Primary caller' : participant.destinationCountry === 'Internal' ? `Extension ${participant.number}` : participant.number}</Text></View>{index === 0 ? <Text style={styles.primaryParticipant}>PRIMARY</Text> : <Pressable accessibilityLabel={`Remove ${participant.displayName || participant.number}`} disabled={!!removingParticipant} onPress={() => participant.id && removeParticipant(participant.id)} style={styles.removeParticipant}>{removingParticipant === participant.id ? <ActivityIndicator size="small" color={colors.coral} /> : <UserMinus size={19} color={colors.coral} />}</Pressable>}</View>)}</ScrollView></View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  pageContent: { flexGrow: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  top: { minHeight: 84, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  minimize: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  secure: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  secureDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mint },
  secureText: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
  identity: { flex: 1, alignItems: 'center', paddingTop: 18, paddingBottom: 24, paddingHorizontal: 20 },
  waiting: { minHeight: 58, width: '90%', paddingHorizontal: 10, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.amber },
  waitingCopy: { flex: 1, minWidth: 0 },
  waitingLabel: { color: colors.amber, fontSize: 9, fontWeight: '900' },
  waitingNumber: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 4 },
  decline: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center' },
  answer: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  avatarOuter: { width: 108, height: 108, borderRadius: 54, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#12334A', alignItems: 'center', justifyContent: 'center' },
  avatarPhoto: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#12334A' },
  avatarInitials: { color: colors.blue, fontSize: 30, fontWeight: '600' },
  name: { width: '100%', textAlign: 'center', color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: 0 },
  number: { color: colors.textMuted, fontSize: 15, marginTop: 7, fontVariant: ['tabular-nums'] },
  status: { color: colors.amber, fontSize: 12, fontWeight: '800', marginTop: 22, textTransform: 'uppercase' },
  statusLive: { color: colors.mint },
  timer: { color: colors.text, fontSize: 38, fontWeight: '300', marginTop: 8, fontVariant: ['tabular-nums'] },
  rate: { color: colors.textFaint, fontSize: 11, marginTop: 7 },
  held: { height: 40, maxWidth: '90%', marginTop: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 8, backgroundColor: colors.panel },
  heldCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#12334A', alignItems: 'center', justifyContent: 'center' },
  heldText: { flex: 1, color: colors.textMuted, fontSize: 10 },
  swapButton: { height: 28, paddingHorizontal: 9, borderRadius: 6, backgroundColor: colors.mint, justifyContent: 'center' },
  swapText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  conference: { minHeight: 48, width: '90%', marginTop: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 8, backgroundColor: '#102E43', borderWidth: 1, borderColor: colors.blue },
  conferenceIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  conferenceCopy: { flex: 1, minWidth: 0 },
  conferenceLabel: { color: colors.mint, fontSize: 8, fontWeight: '900' },
  conferenceNames: { color: colors.text, fontSize: 10, fontWeight: '700', marginTop: 3 },
  liveBadge: { height: 22, paddingHorizontal: 7, borderRadius: 5, backgroundColor: '#173E50', justifyContent: 'center' },
  liveBadgeText: { color: colors.mint, fontSize: 8, fontWeight: '900' },
  mergeError: { width: '90%', color: colors.coral, fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 7 },
  greetingPrompt: { width: '90%', marginTop: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, backgroundColor: '#101C27', borderWidth: 1, borderColor: '#20364A' },
  greetingLabel: { color: colors.blue, fontSize: 8, fontWeight: '900' },
  greetingText: { color: colors.text, fontSize: 11, lineHeight: 15, marginTop: 4 },
  controlsSection: { paddingHorizontal: 22, alignItems: 'center' },
  incomingActions: { paddingHorizontal: 42, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  incomingAction: { width: 82, minHeight: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', gap: 5, ...shadow },
  incomingDecline: { backgroundColor: colors.coral },
  incomingAccept: { backgroundColor: colors.mint },
  incomingActionLabel: { color: colors.white, fontSize: 10, fontWeight: '800' },
  incomingAcceptLabel: { color: colors.ink },
  controlsRow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: 16, marginBottom: 24 },
  controlWrap: { width: '33.333%', alignItems: 'center', gap: 7 },
  control: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.line },
  controlActive: { backgroundColor: colors.mint, borderColor: colors.mint },
  controlDisabled: { opacity: 0.42 },
  controlLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  controlLabelActive: { color: colors.mint },
  pressed: { opacity: 0.7 },
  end: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center', ...shadow },
  endPressed: { transform: [{ scale: 0.93 }], opacity: 0.82 },
  keypadModal: { flex: 1, paddingHorizontal: 24, backgroundColor: colors.canvas },
  keypadHeader: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keypadTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  done: { minWidth: 58, height: 40, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: colors.mint, fontSize: 15, fontWeight: '800' },
  keypadNumber: { color: colors.textMuted, textAlign: 'center', fontSize: 15, marginTop: 30 },
  keypadBody: { flex: 1, justifyContent: 'center' },
  addModal: { flex: 1, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 24, backgroundColor: colors.canvas },
  addHeader: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addEyebrow: { color: colors.mint, fontSize: 10, fontWeight: '900' },
  addTitle: { color: colors.text, fontSize: 23, fontWeight: '800', marginTop: 4 },
  addClose: { width: 42, height: 42, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  addCountry: { height: 50, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  addFlag: { fontSize: 23 },
  addCountryName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  addNumber: { height: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  addCode: { color: colors.mint, fontSize: 23, fontWeight: '800', marginRight: 8 },
  addDigits: { flex: 1, color: colors.text, fontSize: 24, fontWeight: '700' },
  addPlaceholder: { color: colors.textFaint, fontWeight: '500' },
  addDelete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRate: { height: 30, color: colors.textMuted, fontSize: 10, textAlign: 'center', textAlignVertical: 'center' },
  addError: { color: colors.coral, fontSize: 10, textAlign: 'center' },
  addKeypad: { flex: 1, minHeight: 260, justifyContent: 'center' },
  addButton: { height: 52, borderRadius: 8, backgroundColor: colors.mint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addButtonDisabled: { opacity: 0.28 },
  addButtonText: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  transferPage: { flex: 1, paddingHorizontal: 22, paddingTop: 24, backgroundColor: colors.canvas }, transferHelp: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 14 }, transferError: { color: colors.coral, fontSize: 11, lineHeight: 16, marginBottom: 8 }, transferList: { flex: 1, borderTopWidth: 1, borderTopColor: colors.line }, transferRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line }, transferAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#164361' }, transferPhoto: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.panel }, transferInitial: { color: colors.white, fontSize: 15, fontWeight: '900' }, transferCopy: { flex: 1, minWidth: 0 }, transferName: { color: colors.text, fontSize: 14, fontWeight: '800' }, transferMeta: { color: colors.textMuted, fontSize: 10, marginTop: 4 }, primaryParticipant: { color: colors.mint, fontSize: 9, fontWeight: '900' }, removeParticipant: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#351E2A' },
});
