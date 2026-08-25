import React from 'react';
import { FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Check, PhoneIncoming, X } from 'lucide-react-native';
import type { CallerNumber } from '../types';
import { flagFromCode } from '../data/fallbackRates';
import { colors } from '../theme';

export function CallerIdPicker({ visible, numbers, selected, onSelect, onClose }: { visible: boolean; numbers: CallerNumber[]; selected: CallerNumber | null; onSelect: (number: CallerNumber) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>CALLER ID</Text>
            <Text style={styles.title}>Choose your number</Text>
          </View>
          <Pressable accessibilityLabel="Close caller ID picker" onPress={onClose} style={styles.close}><X color={colors.text} size={22} /></Pressable>
        </View>
        <FlatList
          data={numbers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const active = item.id === selected?.id;
            return (
              <Pressable onPress={() => { onSelect(item); onClose(); }} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <Text style={styles.flag}>{item.country_code ? flagFromCode(item.country_code) : 'ID'}</Text>
                <View style={styles.details}>
                  <Text style={styles.number}>{item.phone_number}</Text>
                  <Text style={styles.label}>{item.label}</Text>
                </View>
                {item.receives_calls && <View style={styles.incoming}><PhoneIncoming size={13} color={colors.mint} /><Text style={styles.incomingText}>Incoming</Text></View>}
                <View style={[styles.check, !active && styles.checkInactive]}>{active && <Check size={16} color={colors.ink} strokeWidth={3} />}</View>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.mint, fontSize: 10, fontWeight: '800' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 4 },
  close: { width: 42, height: 42, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowPressed: { opacity: 0.65 },
  flag: { width: 42, color: colors.textMuted, fontSize: 22, fontWeight: '800' },
  details: { flex: 1 },
  number: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  incoming: { marginRight: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  incomingText: { color: colors.mint, fontSize: 10, fontWeight: '700' },
  check: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  checkInactive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
});
