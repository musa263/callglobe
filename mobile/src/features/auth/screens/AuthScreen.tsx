import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowRight, Eye, EyeOff, Globe2, QrCode, ShieldCheck, X } from 'lucide-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BrandMark } from '../../../shared/components/BrandMark';
import { useAuth } from '../AuthContext';
import { isApiConfigured } from '../../../shared/api';
import { colors } from '../../../shared/theme';

export function AuthScreen() {
  const { signIn, enrollWithQr } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const submit = async () => {
    if (!email.trim() || password.length < 8) {
      setError('Enter your account email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Unable to continue.');
    } finally {
      setBusy(false);
    }
  };

  const openScanner = async () => {
    setError('');
    const result = permission?.granted ? permission : await requestPermission();
    if (!result.granted) {
      setError('Camera access is needed to scan your company setup code.');
      return;
    }
    setShowScanner(true);
  };

  const scanEnrollment = useCallback(async ({ data }: { data: string }) => {
    if (scanning) return;
    const isVocivoLink = data.startsWith('vocivo://enroll?') || /^https:\/\/[^/]+\/enroll\.html(?:[?#]|$)/i.test(data);
    if (!isVocivoLink) return;
    const token = decodeURIComponent(data.match(/[?#&]token=([^&]+)/)?.[1] || '');
    if (!token) return;
    setScanning(true);
    try {
      await enrollWithQr(token);
      setShowScanner(false);
    } catch (scanError) {
      setShowScanner(false);
      setError(scanError instanceof Error ? scanError.message : 'This setup code could not be used.');
    } finally {
      setScanning(false);
    }
  }, [enrollWithQr, scanning]);

  useEffect(() => {
    let mounted = true;
    const openEnrollment = (url: string | null) => {
      if (mounted && url) scanEnrollment({ data: url }).catch(() => undefined);
    };
    Linking.getInitialURL().then(openEnrollment).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => openEnrollment(url));
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [scanEnrollment]);

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={[colors.ink, '#0D2238', colors.ink]} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.top}><BrandMark /></View>
        <View style={styles.heroIcon}><Globe2 color={colors.mint} size={38} strokeWidth={1.7} /></View>
        <Text style={styles.title}>Connect. Talk.{`\n`}Anywhere.</Text>
        <Text style={styles.subtitle}>Clear international voice, messaging and business communications in one mobile app.</Text>

        <View style={styles.form}>
          <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor={colors.textFaint} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />
          <View style={styles.passwordRow}>
            <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.textFaint} secureTextEntry={!showPassword} autoCapitalize="none" style={styles.passwordInput} />
            <Pressable accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword((value) => !value)} style={styles.eye}>
              {showPassword ? <EyeOff size={20} color={colors.textMuted} /> : <Eye size={20} color={colors.textMuted} />}
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable disabled={busy || !isApiConfigured} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); submit(); }} style={({ pressed }) => [styles.submit, pressed && styles.pressed, (!isApiConfigured || busy) && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.ink} /> : <><Text style={styles.submitText}>Sign in securely</Text><ArrowRight size={20} color={colors.ink} strokeWidth={2.7} /></>}
          </Pressable>

          <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View>
          <Pressable disabled={busy || !isApiConfigured} onPress={openScanner} style={({ pressed }) => [styles.qrButton, pressed && styles.pressed]}>
            <QrCode size={20} color={colors.mint} /><Text style={styles.qrButtonText}>Scan company setup QR</Text>
          </Pressable>
        </View>
        <View style={styles.security}><ShieldCheck size={15} color={colors.textFaint} /><Text style={styles.securityText}>Your account and calls are protected in transit.</Text></View>
      </ScrollView>
      <Modal visible={showScanner} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowScanner(false)}>
        <View style={styles.scannerPage}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanning ? undefined : scanEnrollment} />
          <View style={styles.scannerShade} />
          <View style={styles.scannerHeader}><View><Text style={styles.scannerEyebrow}>EXTENSION SETUP</Text><Text style={styles.scannerTitle}>Scan your QR code</Text></View><Pressable accessibilityLabel="Close scanner" onPress={() => setShowScanner(false)} style={styles.scannerClose}><X size={23} color={colors.white} /></Pressable></View>
          <View style={styles.scannerTarget}><QrCode size={42} color={colors.white} /></View>
          <Text style={styles.scannerHelp}>{scanning ? 'Setting up your extension...' : 'Point the camera at the QR code shown by your Vocivo administrator.'}</Text>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 68 : 42, paddingBottom: 28 },
  top: { marginBottom: 42 },
  heroIcon: { width: 66, height: 66, borderRadius: 16, backgroundColor: '#12334A', borderWidth: 1, borderColor: '#2B6282', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  title: { color: colors.text, fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: 0 },
  subtitle: { maxWidth: 350, color: colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: 14 },
  form: { marginTop: 34, gap: 12 },
  input: { height: 54, borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, backgroundColor: colors.panel, color: colors.text, fontSize: 16 },
  passwordRow: { height: 54, borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingLeft: 16, backgroundColor: colors.panel, flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, color: colors.text, fontSize: 16 },
  eye: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.coral, fontSize: 13, lineHeight: 18 },
  submit: { height: 56, marginTop: 4, borderRadius: 8, backgroundColor: colors.mint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  submitText: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  divider: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line }, dividerText: { color: colors.textFaint, fontSize: 9, fontWeight: '900' },
  qrButton: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 8, borderWidth: 1, borderColor: colors.mintDark, backgroundColor: colors.panel },
  qrButtonText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  scannerPage: { flex: 1, backgroundColor: colors.ink },
  scannerShade: { ...StyleSheet.absoluteFillObject, backgroundColor: '#04101E70' },
  scannerHeader: { position: 'absolute', left: 20, right: 20, top: Platform.OS === 'ios' ? 62 : 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scannerEyebrow: { color: colors.mint, fontSize: 9, fontWeight: '900' },
  scannerTitle: { color: colors.white, fontSize: 22, fontWeight: '900', marginTop: 5 },
  scannerClose: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#081525CC' },
  scannerTarget: { position: 'absolute', alignSelf: 'center', top: '31%', width: 250, height: 250, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 3, borderColor: colors.white, backgroundColor: '#06111F20' },
  scannerHelp: { position: 'absolute', left: 32, right: 32, bottom: 80, color: colors.white, fontSize: 14, lineHeight: 21, fontWeight: '700', textAlign: 'center' },
  security: { marginTop: 'auto', paddingTop: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  securityText: { color: colors.textFaint, fontSize: 11 },
});
