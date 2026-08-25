import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { colors } from '../theme';

function quality(type: string, details: Record<string, unknown> | null, connected: boolean | null, reachable: boolean | null) {
  if (!connected || reachable === false) return { bars: 0, label: 'Offline' };
  if (type === 'wifi') {
    const strength = typeof details?.strength === 'number' ? details.strength : 65;
    return { bars: strength >= 75 ? 4 : strength >= 50 ? 3 : strength >= 25 ? 2 : 1, label: 'Wi-Fi' };
  }
  if (type === 'cellular') {
    const generation = String(details?.cellularGeneration ?? '').toUpperCase();
    const bars = generation === '5G' ? 4 : generation === '4G' ? 3 : generation === '3G' ? 2 : 1;
    return { bars, label: generation || 'Mobile' };
  }
  return { bars: 3, label: 'Connected' };
}

export function NetworkStrength({ voiceReady }: { voiceReady: boolean }) {
  const netInfo = useNetInfo();
  const state = useMemo(
    () => quality(netInfo.type, netInfo.details as Record<string, unknown> | null, netInfo.isConnected, netInfo.isInternetReachable),
    [netInfo.details, netInfo.isConnected, netInfo.isInternetReachable, netInfo.type],
  );
  const ready = state.bars > 0 && voiceReady;

  return (
    <View accessibilityLabel={`Network ${state.label}, ${state.bars} of 4 bars`} style={styles.row}>
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((bar) => <View key={bar} style={[styles.bar, { height: 3 + bar * 2 }, bar <= state.bars && styles.barActive]} />)}
      </View>
      <Text style={[styles.label, !state.bars && styles.offline]}>{state.label}</Text>
      <View style={[styles.dot, ready && styles.dotReady]} />
      <Text style={styles.voice}>{ready ? 'Voice ready' : state.bars ? 'Connecting voice' : 'No connection'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  bars: { width: 22, height: 13, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 3, borderRadius: 1, backgroundColor: colors.textFaint },
  barActive: { backgroundColor: colors.mint },
  label: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
  offline: { color: colors.coral },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.amber },
  dotReady: { backgroundColor: colors.mint },
  voice: { color: colors.textFaint, fontSize: 10 },
});
