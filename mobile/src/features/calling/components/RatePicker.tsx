import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Search, X } from 'lucide-react-native';
import type { CallRate } from '../../../shared/types';
import { flagFromCode } from '../../billing/data/fallbackRates';
import { colors } from '../../../shared/theme';

export function RatePicker({ visible, rates, selected, onSelect, onClose }: { visible: boolean; rates: CallRate[]; selected: CallRate; onSelect: (rate: CallRate) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return rates;
    return rates.filter((rate) => `${rate.country_name} ${rate.country_code} ${rate.dial_code}`.toLowerCase().includes(value));
  }, [query, rates]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DESTINATION</Text>
            <Text style={styles.title}>Choose a country</Text>
            <Text style={styles.count}>{rates.length} international destinations</Text>
          </View>
          <Pressable accessibilityLabel="Close country picker" onPress={onClose} style={styles.close}><X color={colors.text} size={22} /></Pressable>
        </View>
        <View style={styles.search}>
          <Search color={colors.textMuted} size={19} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search country or code" placeholderTextColor={colors.textFaint} style={styles.input} autoFocus={false} />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const active = item.id === selected.id;
            return (
              <Pressable onPress={() => { onSelect(item); onClose(); }} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <Text style={styles.flag}>{flagFromCode(item.country_code)}</Text>
                <View style={styles.country}>
                  <Text style={styles.countryName}>{item.country_name}</Text>
                  <Text style={styles.rate}>{item.rate_per_min ? `$${item.rate_per_min.toFixed(3)} per min est.` : 'Live carrier rate'}</Text>
                </View>
                <Text style={styles.code}>{item.dial_code}</Text>
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
  count: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  close: { width: 42, height: 42, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  search: { height: 50, marginHorizontal: 20, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.panel },
  input: { flex: 1, color: colors.text, fontSize: 16 },
  list: { paddingHorizontal: 20, paddingVertical: 14, paddingBottom: 40 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowPressed: { opacity: 0.65 },
  flag: { width: 42, fontSize: 25 },
  country: { flex: 1 },
  countryName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rate: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  code: { color: colors.textMuted, fontSize: 14, fontWeight: '600', marginRight: 14 },
  check: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', opacity: 1 },
  checkInactive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
});
