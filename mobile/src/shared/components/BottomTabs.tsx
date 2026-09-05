import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Clock3, ContactRound, House, MessageSquareText, Settings2, type LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { AppTab } from '../types';
import { colors } from '../theme';

const tabs: Array<{ id: AppTab; label: string; icon: LucideIcon }> = [
  { id: 'dial', label: 'Home', icon: House },
  { id: 'contacts', label: 'Contacts', icon: ContactRound },
  { id: 'recents', label: 'Recents', icon: Clock3 },
  { id: 'messages', label: 'Messages', icon: MessageSquareText },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

export function BottomTabs({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {tabs.map(({ id, label, icon: Icon }) => {
        const selected = id === active;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(id);
            }}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View style={[styles.iconWrap, selected && styles.iconSelected]}>
              <Icon size={20} color={selected ? colors.ink : colors.textFaint} strokeWidth={selected ? 2.7 : 2.1} />
            </View>
            <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { minHeight: 70, paddingTop: 8, flexDirection: 'row', backgroundColor: colors.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3 },
  pressed: { opacity: 0.7 },
  iconWrap: { width: 36, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconSelected: { backgroundColor: colors.mint },
  label: { color: colors.textFaint, fontSize: 10, fontWeight: '700' },
  labelSelected: { color: colors.text },
});
