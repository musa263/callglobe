import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BrandMark } from './BrandMark';
import { colors } from '../theme';

export function PageHeading({ title }: { title?: string }) {
  return <View style={styles.heading}><BrandMark compact />{title && <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>}</View>;
}

const styles = StyleSheet.create({
  heading: { flexShrink: 1, minWidth: 0, paddingVertical: 6 },
  title: { color: colors.textMuted, fontSize: 14, fontWeight: '600', marginTop: 5 },
});
