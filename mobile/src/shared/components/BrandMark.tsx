import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.row}>
      <Image source={require('../../../assets/vocivo-icon.png')} style={[styles.mark, compact && styles.markCompact]} />
      <View><Text style={[styles.name, compact && styles.nameCompact]}>Vocivo</Text>{!compact && <Text style={styles.slogan}>Connect. Talk. Anywhere.</Text>}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 38, height: 38, borderRadius: 10 },
  markCompact: { width: 30, height: 30, borderRadius: 8 },
  name: { color: colors.text, fontSize: 23, fontWeight: '800', letterSpacing: 0 },
  nameCompact: { fontSize: 19 },
  slogan: { color: colors.textMuted, fontSize: 8, fontWeight: '700', marginTop: 2 },
});
