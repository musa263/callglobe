import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { colors } from '../theme';
import { networkPresentation } from '../lib/networkPresentation';

export function NetworkStrength({ voiceReady }: { voiceReady: boolean }) {
  const netInfo = useNetInfo();
  const [offlineConfirmed, setOfflineConfirmed] = useState(false);
  useEffect(() => {
    if (netInfo.isConnected !== false) {
      setOfflineConfirmed(false);
      return;
    }
    const timer = setTimeout(() => setOfflineConfirmed(true), 2500);
    return () => clearTimeout(timer);
  }, [netInfo.isConnected]);
  const state = useMemo(
    () => networkPresentation(netInfo.type, netInfo.details as Record<string, unknown> | null, offlineConfirmed ? false : null, netInfo.isInternetReachable, voiceReady),
    [netInfo.details, netInfo.isInternetReachable, netInfo.type, offlineConfirmed, voiceReady],
  );
  const ready = state.status === 'Voice ready';

  return (
    <View accessibilityLabel={`Network ${state.label}, ${state.bars} of 4 bars`} style={styles.row}>
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((bar) => <View key={bar} style={[styles.bar, { height: 3 + bar * 2 }, bar <= state.bars && styles.barActive]} />)}
      </View>
      <Text style={[styles.label, !state.bars && styles.offline]}>{state.label}</Text>
      <View style={[styles.dot, ready && styles.dotReady]} />
      <Text style={styles.voice}>{state.status}</Text>
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
