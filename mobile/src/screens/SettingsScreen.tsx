import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { BellRing, Building2, Camera, Check, ChevronRight, Clock3, CreditCard, KeyRound, LogOut, Phone, Plus, Radio, Settings2, Signal, Trash2, UserRoundPen, Voicemail, WifiOff, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { useBusiness, type BusinessProfile } from '../context/BusinessContext';
import { useVoice } from '../context/VoiceContext';
import { api } from '../lib/api';
import { applyIncomingRingtone, defaultRingtone, loadIncomingRingtone, ringtoneOptions, type RingtoneId } from '../lib/ringtone';
import { colors } from '../theme';

function Row({ icon: Icon, title, subtitle, danger, onPress }: { icon: React.ElementType; title: string; subtitle?: string; danger?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={[styles.rowIcon, danger && styles.rowIconDanger]}><Icon size={19} color={danger ? colors.coral : colors.textMuted} /></View><View style={styles.rowCopy}><Text style={[styles.rowTitle, danger && styles.danger]}>{title}</Text>{subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}</View>{!danger && <ChevronRight size={18} color={colors.textFaint} />}</Pressable>;
}

const Label = ({ children }: { children: React.ReactNode }) => <Text style={styles.fieldLabel}>{children}</Text>;

export function SettingsScreen({ openBusinessNonce = 0, onBusinessConsumed, onWallet }: { openBusinessNonce?: number; onBusinessConsumed?: () => void; onWallet: () => void }) {
  const insets = useSafeAreaInsets();
  const { profile, signOut, isPreview, updateProfile } = useAuth();
  const { profile: business, saveProfile } = useBusiness();
  const { pushRegistration, refreshIncomingCalls } = useVoice();
  const [showBusiness, setShowBusiness] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRingtones, setShowRingtones] = useState(false);
  const [showVoicemail, setShowVoicemail] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [draft, setDraft] = useState<BusinessProfile>(business);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [ringtone, setRingtone] = useState<RingtoneId>(defaultRingtone);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [showEsim, setShowEsim] = useState(false);
  const [network, setNetwork] = useState<NetInfoState | null>(null);
  const [profileDraft, setProfileDraft] = useState({ fullName: '', jobTitle: '', department: '', mobile: '', location: '', bio: '' });
  const [profilePhoto, setProfilePhoto] = useState<{ uri: string; base64: string; mimeType: string } | null>(null);

  useEffect(() => { if (showBusiness) setDraft(business); }, [business, showBusiness]);
  useEffect(() => {
    if (!openBusinessNonce) return;
    setShowBusiness(true);
    onBusinessConsumed?.();
  }, [onBusinessConsumed, openBusinessNonce]);
  useEffect(() => { loadIncomingRingtone().then(setRingtone).catch(() => undefined); }, []);
  useEffect(() => { const unsubscribe = NetInfo.addEventListener(setNetwork); return unsubscribe; }, []);
  const initials = (profile?.full_name || profile?.email || 'VO').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const canManagePhoneSystem = isPreview || ['superadmin', 'company_owner', 'company_admin', 'owner', 'admin'].includes(profile?.role || '');

  const openProfile = () => {
    setProfileDraft({ fullName: profile?.full_name || '', jobTitle: profile?.job_title || '', department: profile?.department || '', mobile: profile?.mobile || '', location: profile?.location || '', bio: profile?.bio || '' });
    setProfilePhoto(null); setError(''); setShowProfile(true);
  };

  const chooseProfilePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true });
    const asset = result.assets?.[0];
    if (!result.canceled && asset?.uri && asset.base64) setProfilePhoto({ uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType || 'image/jpeg' });
  };

  const savePersonalProfile = async () => {
    if (!profileDraft.fullName.trim()) { setError('Add your full name.'); return; }
    setSaving(true); setError('');
    try {
      await updateProfile({ ...profileDraft, fullName: profileDraft.fullName.trim(), photo: profilePhoto ? { base64: profilePhoto.base64, mimeType: profilePhoto.mimeType } : undefined });
      setShowProfile(false); setProfilePhoto(null);
    } catch (profileError) { setError(profileError instanceof Error ? profileError.message : 'Could not save your profile.'); }
    finally { setSaving(false); }
  };

  const saveBusiness = async () => {
    if (draft.departments.length < 2 || draft.departments.some((department) => !department.trim())) {
      setError('Name every division before saving. At least two divisions are required.');
      return;
    }
    setSaving(true); setError('');
    try { await saveProfile(draft); setShowBusiness(false); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save voice settings.'); }
    finally { setSaving(false); }
  };

  const saveVoicemail = async () => {
    if (draft.voicemailEnabled && !draft.voicemailGreeting.trim()) {
      setError('Add the greeting callers should hear before leaving a message.');
      return;
    }
    setSaving(true); setError('');
    try { await saveProfile(draft); setShowVoicemail(false); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save voicemail settings.'); }
    finally { setSaving(false); }
  };

  const resetPassword = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/api/auth/password', { current_password: currentPassword, new_password: newPassword });
      setShowPassword(false); setCurrentPassword(''); setNewPassword('');
      Alert.alert('Password updated', 'Use your new password the next time you sign in.');
    } catch (passwordError) { setError(passwordError instanceof Error ? passwordError.message : 'Could not update password.'); }
    finally { setSaving(false); }
  };

  const selectRingtone = async (next: RingtoneId) => {
    setSaving(true); setError('');
    try { await applyIncomingRingtone(next); setRingtone(next); setShowRingtones(false); }
    catch (ringtoneError) { setError(ringtoneError instanceof Error ? ringtoneError.message : 'Could not update the ringtone.'); }
    finally { setSaving(false); }
  };

  const changeCallMode = async (enabled: boolean) => {
    if (business.enabled === enabled || switchingMode) return;
    setSwitchingMode(true); setError('');
    try { await saveProfile({ ...business, enabled }); }
    catch (modeError) { Alert.alert('Could not change call mode', modeError instanceof Error ? modeError.message : 'Try again shortly.'); }
    finally { setSwitchingMode(false); }
  };

  return <>
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) }]} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><Text style={styles.eyebrow}>YOUR ACCOUNT</Text><Text style={styles.title}>Settings</Text></View>
      <Pressable onPress={openProfile} style={styles.profile}>{profile?.photo_url ? <Image source={{ uri: profile.photo_url }} style={styles.avatarImage} /> : <View style={styles.avatar}><Text style={styles.initials}>{initials}</Text></View>}<View style={styles.profileCopy}><Text style={styles.profileName}>{profile?.full_name || 'Vocivo member'}</Text><Text style={styles.profileEmail}>{profile?.job_title || profile?.email}</Text></View>{isPreview ? <View style={styles.previewBadge}><Text style={styles.previewBadgeText}>PREVIEW</Text></View> : <ChevronRight size={18} color={colors.textFaint} />}</Pressable>
      <Text style={styles.sectionLabel}>ACCOUNT</Text>
      <View style={styles.group}><Row icon={UserRoundPen} title="Personal profile" subtitle="Photo, name, role and contact details" onPress={openProfile} /></View>
      {canManagePhoneSystem && <><Text style={styles.sectionLabel}>CALL HANDLING</Text>
      <View style={styles.callMode}><Pressable onPress={() => changeCallMode(false)} style={[styles.callModeButton, !business.enabled && styles.callModeActive]}><Phone size={17} color={!business.enabled ? colors.ink : colors.textMuted} /><View><Text style={[styles.callModeTitle, !business.enabled && styles.callModeTitleActive]}>Direct</Text><Text style={[styles.callModeHelp, !business.enabled && styles.callModeHelpActive]}>Ring the app</Text></View></Pressable><Pressable onPress={() => changeCallMode(true)} style={[styles.callModeButton, business.enabled && styles.callModeActive]}><Building2 size={17} color={business.enabled ? colors.ink : colors.textMuted} /><View><Text style={[styles.callModeTitle, business.enabled && styles.callModeTitleActive]}>Business</Text><Text style={[styles.callModeHelp, business.enabled && styles.callModeHelpActive]}>Greeting and extensions</Text></View></Pressable>{switchingMode && <View style={styles.callModeBusy}><ActivityIndicator size="small" color={colors.mint} /></View>}</View></>}
      <Text style={styles.sectionLabel}>PHONE SYSTEM</Text>
      <View style={styles.group}>
        {canManagePhoneSystem && <Row icon={Building2} title="Professional Voice" subtitle={business.enabled ? `${business.companyName} IVR is active` : 'Greeting, departments and waiting message'} onPress={() => setShowBusiness(true)} />}
        {canManagePhoneSystem && <Row icon={Voicemail} title="Voicemail" subtitle={business.voicemailEnabled ? `On after ${business.voicemailDelaySeconds} seconds` : 'Off · unanswered calls keep ringing'} onPress={() => { setDraft(business); setError(''); setShowVoicemail(true); }} />}
        <Row icon={BellRing} title="Incoming ringtone" subtitle={ringtoneOptions.find((option) => option.id === ringtone)?.label} onPress={() => { setError(''); setShowRingtones(true); }} />
        <Row icon={Signal} title="Calls when app is closed" subtitle={pushRegistration === 'registered' ? 'Registered with iPhone CallKit' : pushRegistration === 'registering' ? 'Registering this iPhone...' : 'Needs registration'} onPress={() => refreshIncomingCalls().then(() => Alert.alert('Incoming calls ready', 'This iPhone is registered to ring through CallKit when Vocivo is closed.')).catch((registrationError) => Alert.alert('Registration failed', registrationError instanceof Error ? registrationError.message : 'Reopen Vocivo and try again.'))} />
        <Row icon={CreditCard} title="Calling balance" subtitle={profile?.balance == null ? 'Managed by your organization' : `${profile?.currency || 'USD'} ${Number(profile.balance).toFixed(2)} available`} onPress={onWallet} />
        <Row icon={Radio} title="Travel data eSIM" subtitle={network?.isConnected ? `${network.type === 'cellular' ? 'Using cellular data' : 'Connected by Wi-Fi'} · carrier activation` : 'No internet connection · carrier coverage required'} onPress={() => setShowEsim(true)} />
        <Row icon={Settings2} title="iPhone permissions" subtitle="Contacts, microphone and notifications" onPress={() => Linking.openSettings()} />
      </View>
      {['superadmin', 'company_owner', 'owner'].includes(profile?.role || '') && <><Text style={styles.sectionLabel}>SECURITY</Text>
      <View style={styles.group}><Row icon={KeyRound} title="Reset password" subtitle="Change your Vocivo sign-in password" onPress={() => { setError(''); setShowPassword(true); }} /></View></>}
      <View style={styles.group}><Row icon={LogOut} title={isPreview ? 'Exit preview' : 'Sign out'} danger onPress={signOut} /></View>
      <Text style={styles.version}>Vocivo 1.0.0 · Build {Constants.nativeBuildVersion || 'development'}</Text>
    </ScrollView>

    <Modal visible={showProfile} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowProfile(false)}>
      <ScrollView style={styles.modalPage} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
        <View style={styles.modalHeader}><View><Text style={styles.eyebrow}>YOUR ACCOUNT</Text><Text style={styles.modalTitle}>Personal profile</Text></View><Pressable accessibilityLabel="Close profile" onPress={() => setShowProfile(false)} style={styles.close}><X size={21} color={colors.text} /></Pressable></View>
        <Pressable onPress={() => chooseProfilePhoto().catch(() => setError('Photo access is unavailable.'))} style={styles.photoEditor}>{profilePhoto?.uri || profile?.photo_url ? <Image source={{ uri: profilePhoto?.uri || profile?.photo_url }} style={styles.photoPreview} /> : <View style={styles.photoFallback}><Text style={styles.photoInitials}>{initials}</Text></View>}<View style={styles.cameraBadge}><Camera size={17} color={colors.ink} /></View></Pressable>
        <Text style={styles.photoHelp}>Tap to choose a square profile photo</Text>
        <Label>FULL NAME</Label><TextInput value={profileDraft.fullName} onChangeText={(fullName) => setProfileDraft((value) => ({ ...value, fullName }))} style={styles.field} maxLength={80} />
        <Label>JOB TITLE</Label><TextInput value={profileDraft.jobTitle} onChangeText={(jobTitle) => setProfileDraft((value) => ({ ...value, jobTitle }))} style={styles.field} placeholder="Operations manager" placeholderTextColor={colors.textFaint} maxLength={80} />
        <Label>DEPARTMENT</Label><TextInput value={profileDraft.department} onChangeText={(department) => setProfileDraft((value) => ({ ...value, department }))} style={styles.field} placeholder="Operations" placeholderTextColor={colors.textFaint} maxLength={60} />
        <Label>MOBILE</Label><TextInput value={profileDraft.mobile} onChangeText={(mobile) => setProfileDraft((value) => ({ ...value, mobile }))} keyboardType="phone-pad" style={styles.field} placeholder="+966..." placeholderTextColor={colors.textFaint} maxLength={30} />
        <Label>LOCATION</Label><TextInput value={profileDraft.location} onChangeText={(location) => setProfileDraft((value) => ({ ...value, location }))} style={styles.field} placeholder="Riyadh, Saudi Arabia" placeholderTextColor={colors.textFaint} maxLength={80} />
        <Label>ABOUT</Label><TextInput value={profileDraft.bio} onChangeText={(bio) => setProfileDraft((value) => ({ ...value, bio }))} style={[styles.field, styles.message]} multiline placeholder="A short introduction for your colleagues." placeholderTextColor={colors.textFaint} maxLength={240} />
        <Label>EMAIL</Label><View style={[styles.field, styles.readOnlyField]}><Text style={styles.readOnlyText}>{profile?.email}</Text></View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={saving} onPress={savePersonalProfile} style={[styles.save, saving && styles.disabled]}>{saving ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.saveText}>Save profile</Text>}</Pressable>
      </ScrollView>
    </Modal>

    <Modal visible={showBusiness} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowBusiness(false)}>
      <ScrollView style={styles.modalPage} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
        <View style={styles.modalHeader}><View><Text style={styles.eyebrow}>PHONE SYSTEM</Text><Text style={styles.modalTitle}>Professional Voice</Text></View><Pressable accessibilityLabel="Close" onPress={() => setShowBusiness(false)} style={styles.close}><X size={21} color={colors.text} /></Pressable></View>
        <View style={styles.enableRow}><View style={styles.enableCopy}><Text style={styles.fieldTitle}>Answer with voice menu</Text><Text style={styles.fieldHelp}>Incoming calls hear your greeting and choose a division before your app rings.</Text></View><Switch value={draft.enabled} onValueChange={(enabled) => setDraft((value) => ({ ...value, enabled }))} trackColor={{ false: colors.line, true: colors.mintDark }} thumbColor={colors.text} /></View>
        <Label>COMPANY NAME</Label><TextInput value={draft.companyName} onChangeText={(companyName) => setDraft((value) => ({ ...value, companyName }))} style={styles.field} placeholder="Global Heritage" placeholderTextColor={colors.textFaint} />
        <Label>WELCOME MESSAGE</Label><TextInput value={draft.greeting} onChangeText={(greeting) => setDraft((value) => ({ ...value, greeting }))} style={[styles.field, styles.message]} multiline maxLength={500} placeholder="Welcome to Global Heritage." placeholderTextColor={colors.textFaint} />
        <Label>DIVISIONS</Label>
        <View style={styles.divisions}>{draft.departments.map((department, index) => <View key={index} style={styles.divisionRow}><View style={styles.divisionKey}><Text style={styles.divisionKeyText}>{index + 1}</Text></View><TextInput value={department} onChangeText={(name) => setDraft((value) => ({ ...value, departments: value.departments.map((item, itemIndex) => itemIndex === index ? name : item) }))} style={styles.divisionInput} placeholder={`Division ${index + 1}`} placeholderTextColor={colors.textFaint} maxLength={40} />{draft.departments.length > 2 && <Pressable accessibilityLabel={`Remove ${department || `division ${index + 1}`}`} onPress={() => setDraft((value) => ({ ...value, departments: value.departments.filter((_, itemIndex) => itemIndex !== index) }))} style={styles.deleteDivision}><Trash2 size={17} color={colors.coral} /></Pressable>}</View>)}</View>
        {draft.departments.length < 5 && <Pressable onPress={() => setDraft((value) => ({ ...value, departments: [...value.departments, ''] }))} style={styles.addDivision}><Plus size={17} color={colors.mint} /><Text style={styles.addDivisionText}>Add division</Text><Text style={styles.divisionCount}>{draft.departments.length}/5</Text></Pressable>}
        <Label>MESSAGE WHILE WAITING</Label><TextInput value={draft.waitingMessage} onChangeText={(waitingMessage) => setDraft((value) => ({ ...value, waitingMessage }))} style={[styles.field, styles.message]} multiline maxLength={500} placeholder="Tell callers about your company while they wait." placeholderTextColor={colors.textFaint} />
        <Label>VOICE</Label><View style={styles.choice}>{[{ label: 'Joanna', value: 'AWS.Polly.Joanna-Neural' }, { label: 'Matthew', value: 'AWS.Polly.Matthew-Neural' }].map((voice) => <Pressable key={voice.value} onPress={() => setDraft((value) => ({ ...value, voice: voice.value }))} style={[styles.choiceButton, draft.voice === voice.value && styles.choiceActive]}><Text style={[styles.choiceText, draft.voice === voice.value && styles.choiceTextActive]}>{voice.label}</Text></Pressable>)}</View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={saving} onPress={saveBusiness} style={[styles.save, saving && styles.disabled]}>{saving ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.saveText}>Save and apply to phone number</Text>}</Pressable>
        <Text style={styles.note}>When enabled, Vocivo answers the call, speaks this menu, then rings your team. Standard voice charges apply.</Text>
      </ScrollView>
    </Modal>

    <Modal visible={showVoicemail} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowVoicemail(false)}>
      <View style={[styles.modalPage, styles.passwordPage]}>
        <View style={styles.modalHeader}><View><Text style={styles.eyebrow}>MISSED CALLS</Text><Text style={styles.modalTitle}>Voicemail</Text></View><Pressable accessibilityLabel="Close" onPress={() => setShowVoicemail(false)} style={styles.close}><X size={21} color={colors.text} /></Pressable></View>
        <View style={styles.enableRow}><View style={styles.enableCopy}><Text style={styles.fieldTitle}>Send unanswered calls to voicemail</Text><Text style={styles.fieldHelp}>Works for Direct and Business calls, including when Vocivo is closed.</Text></View><Switch value={draft.voicemailEnabled} onValueChange={(voicemailEnabled) => setDraft((value) => ({ ...value, voicemailEnabled }))} trackColor={{ false: colors.line, true: colors.mintDark }} thumbColor={colors.text} /></View>
        <Label>RING FOR</Label>
        <View style={styles.choice}>{[15, 25, 40, 60].map((seconds) => <Pressable key={seconds} onPress={() => setDraft((value) => ({ ...value, voicemailDelaySeconds: seconds }))} style={[styles.choiceButton, draft.voicemailDelaySeconds === seconds && styles.choiceActive]}><Clock3 size={14} color={draft.voicemailDelaySeconds === seconds ? colors.mint : colors.textFaint} /><Text style={[styles.choiceText, draft.voicemailDelaySeconds === seconds && styles.choiceTextActive]}>{seconds}s</Text></Pressable>)}</View>
        <Label>VOICEMAIL GREETING</Label><TextInput editable={draft.voicemailEnabled} value={draft.voicemailGreeting} onChangeText={(voicemailGreeting) => setDraft((value) => ({ ...value, voicemailGreeting }))} style={[styles.field, styles.message, !draft.voicemailEnabled && styles.disabled]} multiline maxLength={500} placeholder="Please leave a message after the tone." placeholderTextColor={colors.textFaint} />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={saving} onPress={saveVoicemail} style={[styles.save, saving && styles.disabled]}>{saving ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.saveText}>Save voicemail settings</Text>}</Pressable>
        <Text style={styles.note}>Messages appear under Recents → Voicemail. Recordings are stored privately and require your Vocivo sign-in.</Text>
      </View>
    </Modal>

    <Modal visible={showRingtones} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRingtones(false)}>
      <View style={[styles.modalPage, styles.ringtonePage]}>
        <View style={styles.modalHeader}><View><Text style={styles.eyebrow}>INCOMING CALLS</Text><Text style={styles.modalTitle}>Choose a ringtone</Text></View><Pressable accessibilityLabel="Close" onPress={() => setShowRingtones(false)} style={styles.close}><X size={21} color={colors.text} /></Pressable></View>
        <Text style={styles.ringtoneIntro}>Vocivo uses this sound when iPhone CallKit presents an incoming call.</Text>
        <View style={styles.ringtoneList}>{ringtoneOptions.map((option) => <Pressable disabled={saving} key={option.id} onPress={() => selectRingtone(option.id)} style={({ pressed }) => [styles.ringtoneRow, pressed && styles.pressed]}><View style={[styles.ringtoneIcon, ringtone === option.id && styles.ringtoneIconActive]}><BellRing size={19} color={ringtone === option.id ? colors.ink : colors.blue} /></View><View style={styles.ringtoneCopy}><Text style={styles.ringtoneTitle}>{option.label}</Text><Text style={styles.ringtoneDetail}>{option.description}</Text></View>{ringtone === option.id && <Check size={20} color={colors.mint} />}</Pressable>)}</View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.note}>The iPhone Ring/Silent switch, Focus mode and system volume still control whether sound is audible.</Text>
      </View>
    </Modal>

    <Modal visible={showPassword} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPassword(false)}>
      <View style={[styles.modalPage, styles.passwordPage]}><View style={styles.modalHeader}><View><Text style={styles.eyebrow}>SECURITY</Text><Text style={styles.modalTitle}>Reset password</Text></View><Pressable accessibilityLabel="Close" onPress={() => setShowPassword(false)} style={styles.close}><X size={21} color={colors.text} /></Pressable></View>
        <Label>CURRENT PASSWORD</Label><TextInput secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} style={styles.field} autoCapitalize="none" />
        <Label>NEW PASSWORD</Label><TextInput secureTextEntry value={newPassword} onChangeText={setNewPassword} style={styles.field} autoCapitalize="none" />
        <Text style={styles.fieldHelp}>At least 10 characters with uppercase, lowercase and a number.</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={saving || !currentPassword || !newPassword} onPress={resetPassword} style={[styles.save, (saving || !currentPassword || !newPassword) && styles.disabled]}>{saving ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.saveText}>Update password</Text>}</Pressable>
      </View>
    </Modal>

    <Modal visible={showEsim} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowEsim(false)}>
      <View style={[styles.modalPage, styles.passwordPage]}>
        <View style={styles.modalHeader}><View><Text style={styles.eyebrow}>MOBILE CONNECTIVITY</Text><Text style={styles.modalTitle}>Travel data eSIM</Text></View><Pressable accessibilityLabel="Close" onPress={() => setShowEsim(false)} style={styles.close}><X size={21} color={colors.text} /></Pressable></View>
        <View style={styles.connectivityHero}>{network?.isConnected ? <Signal size={30} color={colors.mint} /> : <WifiOff size={30} color={colors.coral} />}<View><Text style={styles.fieldTitle}>{network?.isConnected ? 'Vocivo is online' : 'Vocivo is offline'}</Text><Text style={styles.fieldHelp}>{network?.isConnected ? `Current connection: ${network.type}.` : 'An eSIM can restore data only where a partner mobile network has coverage.'}</Text></View></View>
        <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
        <View style={styles.esimSteps}><Text><Text style={styles.esimStepNumber}>1</Text> Choose a supported country and data plan.</Text><Text><Text style={styles.esimStepNumber}>2</Text> The carrier issues an eSIM activation code.</Text><Text><Text style={styles.esimStepNumber}>3</Text> iPhone installs the plan and Vocivo uses its data.</Text></View>
        <Pressable onPress={() => Linking.openURL('https://support.apple.com/en-sa/118669')} style={styles.save}><Text style={styles.saveText}>View iPhone eSIM setup</Text></Pressable>
        <Text style={styles.note}>Direct in-app activation needs a data-carrier agreement and Apple’s restricted cellular-plan entitlement. No plan is purchased or activated from this build.</Text>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink }, content: { paddingHorizontal: 20, paddingBottom: 40 }, header: { minHeight: 74, justifyContent: 'center' }, eyebrow: { color: colors.mint, fontSize: 10, fontWeight: '800' }, title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 3 },
  profile: { minHeight: 86, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', marginRight: 13 }, avatarImage: { width: 52, height: 52, borderRadius: 26, marginRight: 13, backgroundColor: colors.panel }, initials: { color: colors.ink, fontSize: 18, fontWeight: '900' }, profileCopy: { flex: 1 }, profileName: { color: colors.text, fontSize: 16, fontWeight: '800' }, profileEmail: { color: colors.textMuted, fontSize: 11, marginTop: 4 }, previewBadge: { height: 22, paddingHorizontal: 7, borderRadius: 5, backgroundColor: '#2A2414', justifyContent: 'center' }, previewBadgeText: { color: colors.amber, fontSize: 8, fontWeight: '900' },
  sectionLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '800', marginTop: 25, marginBottom: 8 }, callMode: { height: 68, padding: 3, position: 'relative', flexDirection: 'row', borderRadius: 8, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }, callModeButton: { flex: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 6 }, callModeActive: { backgroundColor: colors.mint }, callModeTitle: { color: colors.text, fontSize: 12, fontWeight: '900' }, callModeTitleActive: { color: colors.ink }, callModeHelp: { color: colors.textFaint, fontSize: 8, marginTop: 3 }, callModeHelpActive: { color: '#17354A' }, callModeBusy: { position: 'absolute', right: 7, top: 7 }, group: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, marginBottom: 18 }, row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed: { opacity: 0.65 }, rowIcon: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center', marginRight: 12 }, rowIconDanger: { backgroundColor: '#281616' }, rowCopy: { flex: 1 }, rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' }, rowSubtitle: { color: colors.textFaint, fontSize: 10, marginTop: 4 }, danger: { color: colors.coral }, version: { color: colors.textFaint, textAlign: 'center', fontSize: 10, marginTop: 10 },
  modalPage: { flex: 1, backgroundColor: colors.canvas }, modalContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 }, passwordPage: { paddingHorizontal: 20, paddingTop: 22 }, ringtonePage: { paddingHorizontal: 20, paddingTop: 22 }, modalHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { color: colors.text, fontSize: 23, fontWeight: '800', marginTop: 4 }, close: { width: 42, height: 42, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' }, photoEditor: { width: 106, height: 106, alignSelf: 'center', marginTop: 16 }, photoPreview: { width: 106, height: 106, borderRadius: 53, backgroundColor: colors.panel }, photoFallback: { width: 106, height: 106, borderRadius: 53, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue }, photoInitials: { color: colors.ink, fontSize: 30, fontWeight: '900' }, cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint, borderWidth: 3, borderColor: colors.canvas }, photoHelp: { color: colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 10 }, enableRow: { minHeight: 84, marginTop: 10, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, enableCopy: { flex: 1, paddingRight: 14 }, fieldTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, fieldHelp: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 6 }, fieldLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '900', marginTop: 20, marginBottom: 8 }, field: { minHeight: 48, paddingHorizontal: 12, borderRadius: 8, color: colors.text, fontSize: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }, readOnlyField: { justifyContent: 'center', opacity: 0.72 }, readOnlyText: { color: colors.textMuted, fontSize: 14 }, message: { height: 94, paddingTop: 12, textAlignVertical: 'top' }, divisions: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, divisionRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, divisionKey: { width: 32, height: 32, borderRadius: 7, backgroundColor: '#12334A', alignItems: 'center', justifyContent: 'center' }, divisionKeyText: { color: colors.mint, fontSize: 12, fontWeight: '900' }, divisionInput: { flex: 1, minHeight: 52, paddingHorizontal: 12, color: colors.text, fontSize: 14, fontWeight: '700' }, deleteDivision: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, addDivision: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }, addDivisionText: { flex: 1, color: colors.mint, fontSize: 12, fontWeight: '800' }, divisionCount: { color: colors.textFaint, fontSize: 10, fontWeight: '800' }, choice: { height: 46, padding: 3, flexDirection: 'row', borderRadius: 8, backgroundColor: colors.panel }, choiceButton: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, choiceActive: { backgroundColor: colors.panelRaised }, choiceText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' }, choiceTextActive: { color: colors.mint }, error: { color: colors.coral, fontSize: 11, lineHeight: 16, marginTop: 14, textAlign: 'center' }, save: { height: 52, marginTop: 24, borderRadius: 8, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.35 }, saveText: { color: colors.ink, fontSize: 14, fontWeight: '900' }, note: { color: colors.textFaint, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10, paddingHorizontal: 12 }, ringtoneIntro: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 18 }, ringtoneList: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, ringtoneRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, ringtoneIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel }, ringtoneIconActive: { backgroundColor: colors.mint }, ringtoneCopy: { flex: 1, minWidth: 0, paddingHorizontal: 12 }, ringtoneTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, ringtoneDetail: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  connectivityHero: { minHeight: 94, marginTop: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.panel },
  esimSteps: { gap: 16, paddingVertical: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }, esimStepNumber: { color: colors.mint, fontWeight: '900' },
});
