import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '../../../shared/components/BrandMark';
import { colors } from '../../../shared/theme';

export function LaunchScreen() {
  const insets = useSafeAreaInsets();
  return <View accessibilityLabel="Restoring Vocivo account" accessibilityState={{ busy: true }} style={[styles.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
    <BrandMark compact />
    <View style={styles.body}><View style={styles.number} /><View style={styles.keys}>{Array.from({ length: 12 }, (_, index) => <View key={index} style={styles.key} />)}</View></View>
    <Text style={styles.status}>Restoring your account...</Text>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink, paddingHorizontal: 22 },
  body: { flex: 1, justifyContent: 'center' },
  number: { height: 48, backgroundColor: colors.panel, borderRadius: 8, marginBottom: 40 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 20 },
  key: { width: '27%', height: 52, borderRadius: 8, backgroundColor: colors.panel },
  status: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 20 },
});
