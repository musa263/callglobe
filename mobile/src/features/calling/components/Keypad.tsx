import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../../../shared/theme';

const keys = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

export function Keypad({ onPress, compact = false }: { onPress: (digit: string) => void; compact?: boolean }) {
  return (
    <View style={[styles.grid, compact && styles.gridCompact]}>
      {keys.map(([digit, letters]) => (
        <Pressable
          key={digit}
          accessibilityLabel={`Dial ${digit}`}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPress(digit ?? '');
          }}
          style={({ pressed }) => [styles.key, compact && styles.keyCompact, pressed && styles.keyPressed]}
        >
          <Text style={[styles.digit, compact && styles.digitCompact]}>{digit}</Text>
          <Text style={styles.letters}>{letters}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: '100%', maxWidth: 332, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  gridCompact: { maxWidth: 292, rowGap: 7 },
  key: { width: '30.5%', height: 62, borderRadius: 8, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  keyCompact: { height: 52 },
  keyPressed: { backgroundColor: '#183A54', borderColor: colors.mintDark, transform: [{ scale: 0.96 }] },
  digit: { color: colors.text, fontSize: 25, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  digitCompact: { fontSize: 21, lineHeight: 23 },
  letters: { height: 11, color: colors.textFaint, fontSize: 8, fontWeight: '800' },
});
