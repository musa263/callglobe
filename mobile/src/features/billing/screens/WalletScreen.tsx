import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, ArrowUpRight, Building2, CircleCheck, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { colors, shadow } from '../../../shared/theme';

export function WalletScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { profile, refresh } = useAuth();
  const organizationManaged = profile?.balance == null;
  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) }]} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><Pressable accessibilityLabel="Back to dialer" onPress={onBack} style={styles.back}><ArrowLeft size={21} color={colors.text} /></Pressable><View><Text style={styles.eyebrow}>VOCIVO BILLING</Text><Text style={styles.title}>{organizationManaged ? 'Service plan' : 'Balance'}</Text></View></View>
      <LinearGradient colors={['#17486A', '#10243D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
        <View style={styles.balanceTop}><Text style={styles.balanceLabel}>AVAILABLE CALLING CREDIT</Text><View style={styles.currency}><Text style={styles.currencyText}>{profile?.currency || 'USD'}</Text></View></View>
        <Text adjustsFontSizeToFit numberOfLines={1} style={styles.balance}>{organizationManaged ? (profile?.organization_name || 'Organization managed') : `$${Number(profile?.balance).toFixed(2)}`}</Text>
        <View style={styles.balanceBottom}><View style={styles.available}><View style={styles.liveDot} /><Text style={styles.availableText}>{organizationManaged ? 'Managed by your company' : 'Vocivo calling credit'}</Text></View><Pressable accessibilityLabel="Refresh account" onPress={refresh} style={styles.refresh}><RefreshCw size={16} color={colors.text} /></Pressable></View>
      </LinearGradient>

      <Text style={styles.sectionTitle}>Account control</Text>
      <View style={styles.infoBand}>
        <View style={styles.infoIcon}><Building2 size={21} color={colors.blue} /></View>
        <View style={styles.infoCopy}><Text style={styles.infoTitle}>{organizationManaged ? 'Company-managed service' : 'Vocivo calling credit'}</Text><Text style={styles.infoBody}>{organizationManaged ? 'Your company administrator controls the subscription, calling access and billing.' : 'Your calling service and available credit are managed securely by Vocivo.'}</Text></View>
      </View>

      <Pressable onPress={() => Linking.openURL('mailto:billing@vocivo.app?subject=Vocivo%20billing%20request')} style={({ pressed }) => [styles.manage, pressed && styles.managePressed]}>
        <Text style={styles.manageText}>{organizationManaged ? 'Contact company billing' : 'Manage billing'}</Text><ArrowUpRight size={20} color={colors.ink} />
      </Pressable>

      <Text style={styles.paymentNote}>{organizationManaged ? 'Subscription changes are approved by your company administrator.' : 'Vocivo support can help with plan, invoice and calling-credit questions.'}</Text>

      <View style={styles.checks}>
        <View style={styles.checkRow}><CircleCheck size={18} color={colors.mint} /><Text style={styles.checkText}>No payment details stored in the app</Text></View>
        <View style={styles.checkRow}><CircleCheck size={18} color={colors.mint} /><Text style={styles.checkText}>Company access follows the assigned Vocivo plan</Text></View>
        <View style={styles.checkRow}><ShieldCheck size={18} color={colors.mint} /><Text style={styles.checkText}>Carrier credentials remain protected on the server</Text></View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  eyebrow: { color: colors.mint, fontSize: 10, fontWeight: '800' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 3 },
  balanceCard: { minHeight: 176, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#34749A', justifyContent: 'space-between', ...shadow },
  balanceTop: { flexDirection: 'row', justifyContent: 'space-between' },
  balanceLabel: { color: '#B3CCDF', fontSize: 10, fontWeight: '800' },
  currency: { paddingHorizontal: 8, height: 22, borderRadius: 6, backgroundColor: '#FFFFFF12', alignItems: 'center', justifyContent: 'center' },
  currencyText: { color: colors.text, fontSize: 9, fontWeight: '800' },
  balance: { color: colors.text, fontSize: 42, fontWeight: '800', fontVariant: ['tabular-nums'] },
  balanceBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  available: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mint },
  availableText: { color: colors.mint, fontSize: 11, fontWeight: '700' },
  refresh: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF10' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 28, marginBottom: 13 },
  infoBand: { paddingVertical: 18, flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  infoIcon: { width: 42, height: 42, borderRadius: 8, backgroundColor: '#132136', alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  infoCopy: { flex: 1 },
  infoTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  infoBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  manage: { height: 56, marginTop: 20, borderRadius: 8, backgroundColor: colors.mint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  managePressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  manageText: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  paymentNote: { color: colors.textFaint, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10, paddingHorizontal: 12 },
  checks: { marginTop: 26, gap: 15 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkText: { color: colors.textMuted, fontSize: 12 },
});
