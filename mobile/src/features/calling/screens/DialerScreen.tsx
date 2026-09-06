import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronDown, Delete, Globe2, Phone, Plus, RotateCw, UsersRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocales } from 'expo-localization';
import { CallerIdPicker } from '../components/CallerIdPicker';
import { Keypad } from '../components/Keypad';
import { NetworkStrength } from '../components/NetworkStrength';
import { RatePicker } from '../components/RatePicker';
import { useAuth } from '../../auth/AuthContext';
import { useVoice } from '../VoiceContext';
import type { NavigationTarget } from '../../../shared/types';
import { colors } from '../../../shared/theme';
import { cleanDialInput, defaultDialRegion, dialRegion, resolveCallDestination, resolveDialNumber } from '../state/dialNumber';
import { useCallingDirectory } from '../state/useCallingDirectory';

export function DialerScreen({ onWallet, onConference, target }: {
  onWallet: () => void; onConference: () => void; target: NavigationTarget | null;
}) {
  const insets = useSafeAreaInsets();
  const locales = useLocales();
  const { profile, rates, callerNumbers } = useAuth();
  const { isReady, error, notice, startCall, startInternalCall } = useVoice();
  const inferredRegion = defaultDialRegion(locales[0]?.regionCode, profile?.mobile);
  const [regionOverride, setRegionOverride] = useState<string>();
  const region = dialRegion(regionOverride) || inferredRegion;
  const [number, setNumber] = useState('');
  const [showRates, setShowRates] = useState(false);
  const [showCallerIds, setShowCallerIds] = useState(false);
  const [selectedCaller, setSelectedCaller] = useState(() => callerNumbers[0] ?? null);
  const [callError, setCallError] = useState('');
  const [contactName, setContactName] = useState<string>();
  const [contactPhotoUrl, setContactPhotoUrl] = useState<string>();
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const businessAccount = profile?.account_type === 'business' && Boolean(profile.extension);
  const directory = useCallingDirectory(businessAccount, profile?.organization_id, profile?.id);
  const route = useMemo(() => resolveCallDestination(number, {
    business: businessAccount, ownExtension: profile?.extension, directory: directory.users, region, rates,
  }), [number, businessAccount, profile?.extension, directory.users, region, rates]);
  const { destination } = route;
  const internal = route.kind === 'internal';
  const shortNumber = internal || route.kind === 'unknown-extension' || route.kind === 'self';
  const displayName = route.colleague?.name || contactName;
  const regionRate = rates.find((item) => item.country_code === region);
  const balance = profile?.balance == null ? null : Number(profile.balance);
  const canCall = internal
    ? true
    : Boolean(route.kind === 'external' && selectedCaller && profile?.can_call !== false && (balance == null || balance > 0));

  useEffect(() => {
    if (!selectedCaller || !callerNumbers.some((item) => item.id === selectedCaller.id)) setSelectedCaller(callerNumbers[0] ?? null);
  }, [callerNumbers, selectedCaller]);

  useEffect(() => {
    if (!target) return;
    setContactName(target.name);
    setContactPhotoUrl(target.photoUrl);
    setRegionOverride(dialRegion(target.countryCode));
    setNumber(cleanDialInput(target.number));
    setCallError('');
  }, [target]);

  const editNumber = (value: string) => {
    setContactName(undefined); setContactPhotoUrl(undefined); setCallError('');
    setNumber(cleanDialInput(value));
  };
  const call = async () => {
    if (!canCall || startingRef.current) return;
    const callerCountry = selectedCaller?.country_code || resolveDialNumber(selectedCaller?.phone_number || '').country;
    if (!internal && selectedCaller?.source === 'verified' && callerCountry === destination.country && !['US', 'CA'].includes(destination.country || '')) {
      setCallError('Choose a company number for this destination. The verified caller ID may be filtered.');
      setShowCallerIds(true);
      return;
    }
    startingRef.current = true;
    setStarting(true); setCallError(''); Keyboard.dismiss();
    try {
      if (internal) await startInternalCall('', route.input, displayName || `Extension ${route.input}`, route.colleague?.photoUrl || contactPhotoUrl);
      else await startCall(destination.number, destination.rate, selectedCaller, contactName, contactPhotoUrl);
    } catch (failure) {
      setCallError(failure instanceof Error ? failure.message : 'The call could not be started.');
    } finally {
      startingRef.current = false; setStarting(false);
    }
  };

  return <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <View style={styles.header}>
      <Text style={styles.title}>Dial Pad</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Open calling balance" onPress={onWallet} style={styles.balance}><Text style={styles.balanceText}>{balance == null ? 'Managed' : `$${balance.toFixed(2)}`}</Text><Plus size={16} color={colors.mint} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Start conference" accessibilityHint="Add phone numbers or company colleagues" onPress={onConference} disabled={starting} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><UsersRound size={23} color={colors.blue} /></Pressable>
    </View>
    <View style={styles.identity}>
      <Text numberOfLines={1} style={styles.contactName}>{displayName || ' '}</Text>
      <View style={styles.numberRow}>
        <TextInput accessibilityLabel="Number to call" value={number} onChangeText={editNumber}
          keyboardType="phone-pad" showSoftInputOnFocus={false} autoCorrect={false} autoComplete="off"
          placeholder={businessAccount ? 'Number or extension' : 'Phone number'} placeholderTextColor={colors.textFaint} style={styles.numberInput} />
        <Pressable accessibilityRole="button" accessibilityLabel="Delete last digit" onPress={() => editNumber(number.slice(0, -1))} onLongPress={() => editNumber('')} style={styles.iconButton}><Delete size={23} color={number ? colors.textMuted : colors.textFaint} /></Pressable>
      </View>
      {!shortNumber ? <View style={styles.lineOptions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose default country for local numbers" onPress={() => setShowRates(true)} style={styles.regionButton}><Globe2 size={15} color={colors.blue} /><Text style={styles.optionText}>{destination.country || region || 'Country'}</Text><ChevronDown size={14} color={colors.textMuted} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose outgoing caller ID" onPress={() => setShowCallerIds(true)} style={styles.callerButton}><Text numberOfLines={1} style={styles.optionText}>{selectedCaller?.label || selectedCaller?.phone_number || 'Choose a line'}</Text><ChevronDown size={14} color={colors.textMuted} /></Pressable>
      </View> : <View style={styles.routeDetail} accessibilityLiveRegion="polite">
        <Text style={[styles.internalNote, !internal && styles.notice]}>{internal ? `Extension ${route.input} · Free team call` : route.kind === 'self' ? 'This is your extension' : directory.status === 'loading' ? 'Finding colleague...' : directory.status === 'failed' ? 'Company directory unavailable' : 'No matching company extension'}</Text>
        {directory.status === 'failed' && <Pressable accessibilityRole="button" accessibilityLabel="Retry company directory" onPress={directory.retry} style={styles.iconButton}><RotateCw size={18} color={colors.blue} /></Pressable>}
      </View>}
      <Text numberOfLines={2} style={styles.destination}>{!internal && destination.valid ? `${destination.formatted}${destination.rate.rate_per_min ? `  ·  $${destination.rate.rate_per_min.toFixed(3)}/min est.` : ''}` : ' '}</Text>
    </View>
    <View style={styles.keypad}><Keypad plain onPress={(digit) => editNumber(number + digit)} onPlus={() => editNumber(`+${number.replace(/^\+/, '')}`)} /></View>
    <View style={styles.feedback}>{callError || error ? <Text accessibilityRole="alert" style={styles.error}>{callError || error}</Text> : notice ? <Text style={styles.notice}>{notice}</Text> : <NetworkStrength voiceReady={isReady} />}</View>
    <View style={styles.callArea}>
      <Pressable accessibilityRole="button" accessibilityLabel={starting ? 'Starting call' : 'Start call'} accessibilityState={{ disabled: !canCall || starting, busy: starting }} disabled={!canCall || starting} onPress={call} style={({ pressed }) => [styles.callButton, (!canCall || starting) && styles.callDisabled, pressed && styles.pressed]}>{starting ? <ActivityIndicator color={colors.ink} /> : <Phone size={28} color={colors.ink} fill={colors.ink} />}</Pressable>
    </View>
    <RatePicker visible={showRates} rates={rates} selected={regionRate} onSelect={(rate) => setRegionOverride(rate.country_code)} onClose={() => setShowRates(false)} />
    <CallerIdPicker visible={showCallerIds} numbers={callerNumbers} selected={selectedCaller} onSelect={setSelectedCaller} onClose={() => setShowCallerIds(false)} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 16 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontSize: 21, fontWeight: '700' },
  balance: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  identity: { paddingTop: 16 },
  contactName: { height: 24, textAlign: 'center', color: colors.textMuted, fontSize: 14 },
  numberRow: { height: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.line },
  numberInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 27, fontWeight: '500', paddingVertical: 0, fontVariant: ['tabular-nums'] },
  lineOptions: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 46 },
  regionButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  callerButton: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  optionText: { flexShrink: 1, color: colors.textMuted, fontSize: 12 },
  routeDetail: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  internalNote: { flexShrink: 1, textAlign: 'center', color: colors.mint, fontSize: 12 },
  destination: { minHeight: 32, color: colors.textMuted, textAlign: 'center', fontSize: 11, lineHeight: 16 },
  keypad: { flex: 1, minHeight: 288, justifyContent: 'center', paddingVertical: 8 },
  feedback: { minHeight: 36, justifyContent: 'center' },
  error: { textAlign: 'center', color: colors.amber, fontSize: 12, lineHeight: 18 },
  notice: { textAlign: 'center', color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  callArea: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 8 },
  callButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  callDisabled: { opacity: 0.35 },
  pressed: { opacity: 0.8 },
});
