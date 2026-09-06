import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, ArrowRight, Smartphone } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../shared/api';
import { colors } from '../../../shared/theme';
import { useAuth } from '../AuthContext';

type Challenge = { challengeId: string; expiresAt: number; retryAfter: number };
export function PhoneSignupScreen({ onBack }: { onBack(): void }) {
  const { signInWithPhone } = useAuth();
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!retryAt) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [retryAt]);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const send = async () => {
    if (busyRef.current || Date.now() < retryAt) return;
    if (name.trim().length < 2 || !/^\+[\d\s()-]{7,39}$/.test(phone)) { setError('Enter your name and full phone number with country code.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await api.post<Challenge>('/api/auth/phone', { step: 'start', phone, name });
      if (mounted.current) { setChallenge(result); setCode(''); setNow(Date.now()); setRetryAt(Date.now() + result.retryAfter * 1000); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not send the verification code.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const verify = async () => {
    if (!challenge || busyRef.current || !/^\d{4,8}$/.test(code)) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await signInWithPhone(challenge.challengeId, code); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not verify this code.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" accessibilityLabel="Back to sign in" disabled={busy} onPress={onBack} style={styles.back}><ArrowLeft size={24} color={colors.text} /></Pressable>
      <Smartphone size={32} color={colors.mint} /><Text style={styles.title}>{challenge ? 'Verify your number' : 'Your personal account'}</Text>
      <Text style={styles.subtitle}>{challenge ? `Enter the code sent to ${phone}.` : 'Sign in or create an individual Vocivo account.'}</Text>
      {!challenge ? <>
        <TextInput accessibilityLabel="Your name" placeholder="Your name" placeholderTextColor={colors.textFaint} value={name} onChangeText={setName} editable={!busy} maxLength={50} autoComplete="name" style={styles.input} />
        <TextInput accessibilityLabel="Phone number with country code" placeholder="Phone number with +country code" placeholderTextColor={colors.textFaint} value={phone} onChangeText={setPhone} editable={!busy} maxLength={40} keyboardType="phone-pad" autoComplete="tel" style={styles.input} />
      </> : <TextInput accessibilityLabel="Verification code" placeholder="SMS code" placeholderTextColor={colors.textFaint} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} maxLength={8} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" editable={!busy} style={styles.input} />}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={challenge ? 'Verify and continue' : 'Send verification code'} disabled={busy || Boolean(challenge && !/^\d{4,8}$/.test(code))} onPress={challenge ? verify : send} style={[styles.primary, busy && styles.disabled]}>{busy ? <ActivityIndicator color={colors.ink} /> : <><Text style={styles.primaryText}>{challenge ? 'Verify and continue' : 'Send code'}</Text><ArrowRight size={20} color={colors.ink} /></>}</Pressable>
      {challenge && <View style={styles.links}><Pressable accessibilityRole="button" disabled={busy || remaining > 0} onPress={send} style={styles.link}><Text style={styles.linkText}>{remaining ? `Resend in ${remaining}s` : 'Resend code'}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setChallenge(null); setCode(''); setError(''); }} style={styles.link}><Text style={styles.linkText}>Change number</Text></Pressable></View>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink }, content: { flexGrow: 1, paddingHorizontal: 24, gap: 16 }, back: { width: 48, height: 48, justifyContent: 'center', marginBottom: 24 },
  title: { fontSize: 28, lineHeight: 35, fontWeight: '700', color: colors.text }, subtitle: { fontSize: 15, lineHeight: 22, color: colors.textMuted, marginBottom: 12 },
  input: { minHeight: 56, borderRadius: 8, borderWidth: 1, borderColor: colors.line, color: colors.text, backgroundColor: colors.panel, paddingHorizontal: 14, fontSize: 16 },
  primary: { minHeight: 56, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.mint }, primaryText: { color: colors.ink, fontSize: 16, fontWeight: '700' }, disabled: { opacity: 0.5 },
  error: { color: colors.coral, fontSize: 14, lineHeight: 20 }, links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, link: { minHeight: 48, justifyContent: 'center' }, linkText: { color: colors.blue, fontSize: 14 },
});
