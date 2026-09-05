import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ChevronDown, Delete, Phone, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BrandMark } from '../../../shared/components/BrandMark';
import { CallerIdPicker } from '../components/CallerIdPicker';
import { Keypad } from '../components/Keypad';
import { NetworkStrength } from '../components/NetworkStrength';
import { RatePicker } from '../components/RatePicker';
import { flagFromCode } from '../../billing/data/fallbackRates';
import { useAuth } from '../../auth/AuthContext';
import { useVoice } from '../VoiceContext';
import type { CallRate, NavigationTarget } from '../../../shared/types';
import { colors, shadow } from '../../../shared/theme';

const sanitize = (value: string) => value.replace(/[^0-9*#]/g, '').slice(0, 18);

export function DialerScreen({ onWallet, onConference, target }: { onWallet: () => void; onConference: () => void; target: NavigationTarget | null }) {
  const insets = useSafeAreaInsets();
  const { profile, rates, callerNumbers } = useAuth();
  const { isReady, error, notice, startCall, startInternalCall } = useVoice();
  const [selected, setSelected] = useState<CallRate>(() => rates.find((rate) => rate.country_code === 'SA') ?? rates[0]!);
  const [number, setNumber] = useState('');
  const [showRates, setShowRates] = useState(false);
  const [showCallerIds, setShowCallerIds] = useState(false);
  const [selectedCaller, setSelectedCaller] = useState(() => callerNumbers[0] ?? null);
  const [callError, setCallError] = useState('');
  const [contactName, setContactName] = useState<string | undefined>();
  const [contactPhotoUrl, setContactPhotoUrl] = useState<string | undefined>();
  const [dialMode, setDialMode] = useState<'external' | 'extension'>('external');
  const businessAccount = profile?.account_type === 'business';
  const balance = Number(profile?.balance ?? 0);
  const balanceVisible = profile?.balance != null;
  const minutes = selected.rate_per_min ? Math.floor(balance / selected.rate_per_min) : null;
  const fullNumber = `${selected.dial_code}${number}`;
  const internalCandidate = dialMode === 'extension' && businessAccount;
  const callerCountry = selectedCaller?.country_code || (selectedCaller?.phone_number.startsWith('+966') ? 'SA' : selectedCaller?.phone_number.startsWith('+1') ? 'US' : null);
  const routeRisk = !internalCandidate && selectedCaller?.source === 'verified' && callerCountry === selected.country_code && !['US', 'CA'].includes(selected.country_code);
  const ownedFallback = callerNumbers.find((item) => item.source === 'owned');
  const canCall = internalCandidate ? Boolean(profile?.extension && /^\d{2,5}$/.test(number) && number !== profile.extension) : Boolean(selectedCaller && number.length >= 4 && profile?.can_call !== false && (!balanceVisible || balance > 0));
  const displayNumber = useMemo(() => number.replace(/(.{3})/g, '$1 ').trim(), [number]);

  useEffect(() => {
    if (!selectedCaller || !callerNumbers.some((item) => item.id === selectedCaller.id)) setSelectedCaller(callerNumbers[0] ?? null);
  }, [callerNumbers, selectedCaller]);

  useEffect(() => {
    if (!target) return;
    setDialMode(target.internal && businessAccount ? 'extension' : 'external');
    setContactName(target.name);
    setContactPhotoUrl(target.photoUrl);
    const normalized = target.number.replace(/[^0-9+]/g, '');
    if (target.internal && businessAccount) {
      setNumber(sanitize(normalized));
      setCallError('');
      return;
    }
    const match = [...rates].sort((a, b) => b.dial_code.length - a.dial_code.length).find((rate) => normalized.startsWith(rate.dial_code));
    if (match) {
      setSelected(match);
      setNumber(sanitize(normalized.slice(match.dial_code.length)));
    } else {
      setNumber(sanitize(normalized.replace(/^\+/, '')));
    }
    setCallError('');
  }, [businessAccount, rates, target]);

  const call = async () => {
    if (!canCall) return;
    setCallError('');
    if (routeRisk) {
      setCallError('This verified caller ID may be filtered on a same-country call. Use your Vocivo number.');
      return;
    }
    try {
      Keyboard.dismiss();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (internalCandidate) {
        await startInternalCall('', number, contactName || `Extension ${number}`, contactPhotoUrl);
      } else {
        await startCall(fullNumber, selected, selectedCaller, contactName, contactPhotoUrl);
      }
    } catch (startError) {
      setCallError(startError instanceof Error ? startError.message : 'The call could not be started.');
    }
  };

  return (
    <View style={[styles.page, { paddingTop: Math.max(insets.top, 18) }]}>
      <View style={styles.header}>
        <BrandMark compact />
        <Pressable onPress={onWallet} style={styles.balancePill}><View style={styles.liveDot} /><Text style={styles.balance}>{balanceVisible ? `$${balance.toFixed(2)}` : 'Managed'}</Text><Plus size={15} color={colors.mint} strokeWidth={3} /></Pressable>
      </View>

      <View style={styles.mode}><Pressable onPress={() => { setDialMode('external'); setNumber(''); setCallError(''); }} style={[styles.modeButton, dialMode === 'external' && styles.modeActive]}><Text style={dialMode === 'external' ? styles.modeActiveText : styles.modeText}>External</Text></Pressable>{businessAccount && <Pressable onPress={() => { setDialMode('extension'); setNumber(''); setCallError(''); }} style={[styles.modeButton, dialMode === 'extension' && styles.modeActive]}><Text style={dialMode === 'extension' ? styles.modeActiveText : styles.modeText}>Extension</Text></Pressable>}<Pressable onPress={onConference} style={styles.modeButton}><Text style={styles.modeText}>Conference</Text></Pressable></View>

      <View style={styles.destinationBlock}>
        <Text style={styles.eyebrow}>CALLING</Text>
        <Pressable disabled={internalCandidate} onPress={() => setShowRates(true)} style={styles.countryButton}>
          <Text style={styles.flag}>{internalCandidate ? '#' : flagFromCode(selected.country_code)}</Text>
          <Text style={styles.country}>{internalCandidate ? 'Company extension' : selected.country_name}</Text>
          {!internalCandidate && <ChevronDown size={18} color={colors.textMuted} />}
        </Pressable>
      </View>

      <View style={styles.callerRow}>
        <Text style={styles.callerLabel}>{internalCandidate ? 'INTERNAL CALL FROM' : 'CALLING FROM'}</Text>
        <Pressable disabled={internalCandidate || !callerNumbers.length} onPress={() => setShowCallerIds(true)} style={styles.callerButton}>
          <Text style={[styles.callerNumber, !selectedCaller && !internalCandidate && styles.callerUnavailable]}>{internalCandidate ? (profile?.extension ? `Extension ${profile.extension}` : 'No extension assigned') : selectedCaller?.phone_number ?? 'Network default'}</Text>
          {!internalCandidate && !!callerNumbers.length && <ChevronDown size={15} color={colors.textMuted} />}
        </Pressable>
      </View>

      <View accessibilityLabel={`${internalCandidate ? 'Extension' : selected.dial_code} ${number || (internalCandidate ? 'Company extension' : 'Phone number')}`} style={styles.numberRow}>
        {!internalCandidate && <Text style={styles.dialCode}>{selected.dial_code}</Text>}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[styles.numberInput, !number && styles.numberPlaceholder]}>{displayNumber || (internalCandidate ? 'Company extension' : 'Phone number')}</Text>
        <Pressable accessibilityLabel="Delete last digit" onPress={() => { setContactName(undefined); setContactPhotoUrl(undefined); setNumber((value) => value.slice(0, -1)); }} onLongPress={() => { setContactName(undefined); setContactPhotoUrl(undefined); setNumber(''); }} style={styles.delete}>
          <Delete size={22} color={number ? colors.textMuted : colors.textFaint} />
        </Pressable>
      </View>

      <View style={styles.rateLine}>
        <Text style={styles.rate}>{internalCandidate ? 'Free internal call' : selected.rate_per_min ? `$${selected.rate_per_min.toFixed(3)}/min est.` : 'Live carrier rate'}</Text>
        <View style={styles.dividerDot} />
        <Text style={styles.minutes}>{internalCandidate ? 'No phone number required' : minutes ? `about ${minutes.toLocaleString()} minutes available` : balanceVisible ? 'charged to your calling credit' : 'organization billing'}</Text>
      </View>

      {routeRisk && <View style={styles.routeWarning}><AlertTriangle size={17} color={colors.amber} /><View style={styles.routeCopy}><Text style={styles.routeTitle}>Caller ID may not ring locally</Text><Text style={styles.routeText}>Some countries filter same-country caller IDs arriving through international routes.</Text></View>{ownedFallback && <Pressable onPress={() => { setSelectedCaller(ownedFallback); setCallError(''); }} style={styles.routeButton}><Text style={styles.routeButtonText}>Use +1 line</Text></Pressable>}</View>}

      {(callError || error) ? <Text style={styles.error}>{callError || error}</Text> : notice ? <Text accessibilityRole="text" style={styles.notice}>{notice}</Text> : <NetworkStrength voiceReady={isReady} />}

      <View style={styles.keypadWrap}><Keypad onPress={(digit) => { setContactName(undefined); setContactPhotoUrl(undefined); setNumber((value) => sanitize(value + digit)); }} /></View>

      <View style={styles.callArea}>
        <Pressable accessibilityLabel="Start call" disabled={!canCall} onPress={call} style={({ pressed }) => [styles.callButton, !canCall && styles.callDisabled, pressed && canCall && styles.callPressed]}>
          <Phone size={29} color={colors.ink} fill={colors.ink} strokeWidth={1.5} />
        </Pressable>
        <Text style={styles.callHint}>{internalCandidate ? (canCall ? 'Call extension' : 'Choose another extension') : !selectedCaller ? 'A caller ID must be assigned first' : !canCall && number.length >= 4 ? 'Calling unavailable' : 'Tap to call'}</Text>
      </View>

      <RatePicker visible={showRates} rates={rates} selected={selected} onSelect={setSelected} onClose={() => setShowRates(false)} />
      <CallerIdPicker visible={showCallerIds} numbers={callerNumbers} selected={selectedCaller} onSelect={setSelectedCaller} onClose={() => setShowCallerIds(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink, paddingHorizontal: 20 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balancePill: { height: 36, borderRadius: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mint },
  balance: { color: colors.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mode: { height: 40, padding: 3, marginTop: 12, flexDirection: 'row', backgroundColor: colors.panel, borderRadius: 8 },
  modeButton: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  modeActive: { backgroundColor: colors.panelRaised },
  modeText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' },
  modeActiveText: { color: colors.mint, fontSize: 12, fontWeight: '800' },
  destinationBlock: { alignItems: 'center', marginTop: Platform.OS === 'ios' ? 10 : 6 },
  eyebrow: { color: colors.textFaint, fontSize: 10, fontWeight: '800' },
  countryButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  flag: { fontSize: 23 },
  country: { color: colors.text, fontSize: 16, fontWeight: '700' },
  callerRow: { height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  callerLabel: { color: colors.textFaint, fontSize: 9, fontWeight: '800' },
  callerButton: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4 },
  callerNumber: { color: colors.textMuted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  callerUnavailable: { color: colors.textFaint },
  numberRow: { height: 54, marginTop: 2, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  dialCode: { color: colors.mint, fontSize: 24, fontWeight: '700', marginRight: 8, fontVariant: ['tabular-nums'] },
  numberInput: { flex: 1, color: colors.text, fontSize: 25, fontWeight: '600', letterSpacing: 0, paddingVertical: 0, fontVariant: ['tabular-nums'] },
  numberPlaceholder: { color: colors.textFaint, fontWeight: '500' },
  delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  rateLine: { height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  rate: { color: colors.mint, fontSize: 11, fontWeight: '800' },
  dividerDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  minutes: { color: colors.textMuted, fontSize: 11 },
  error: { minHeight: 22, textAlign: 'center', color: colors.coral, fontSize: 12, lineHeight: 18, marginVertical: 6 },
  notice: { minHeight: 22, textAlign: 'center', color: colors.text, fontSize: 12, lineHeight: 18, marginVertical: 6 },
  routeWarning: { minHeight: 58, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#665423', borderRadius: 8, backgroundColor: '#2B2718' },
  routeCopy: { flex: 1 },
  routeTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  routeText: { color: colors.textMuted, fontSize: 9, lineHeight: 13, marginTop: 2 },
  routeButton: { minHeight: 32, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: colors.amber },
  routeButtonText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  keypadWrap: { flex: 1, minHeight: 270, justifyContent: 'center' },
  callArea: { height: 98, alignItems: 'center', justifyContent: 'flex-start' },
  callButton: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', ...shadow },
  callDisabled: { opacity: 0.28, shadowOpacity: 0 },
  callPressed: { transform: [{ scale: 0.94 }], backgroundColor: colors.mintDark },
  callHint: { color: colors.textFaint, fontSize: 10, marginTop: 7 },
});
