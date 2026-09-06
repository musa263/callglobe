import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Contacts from 'expo-contacts';
import { getLocales } from 'expo-localization';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { ContactRound, MessageSquareText, Phone, Search, ShieldCheck, Video } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ContactPhone } from '../../../shared/types';
import { colors } from '../../../shared/theme';
import { useAuth } from '../../auth/AuthContext';
import { useCallingDirectory } from '../../calling/state/useCallingDirectory';

const cleanNumber = (value: string) => {
  const trimmed = value.trim();
  const region = getLocales()[0]?.regionCode as CountryCode | undefined;
  const parsed = parsePhoneNumberFromString(trimmed, region);
  if (parsed?.isPossible()) return parsed.number;
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
};

export function ContactsScreen({ onCall, onMessage, onVideoMeeting }: { onCall: (contact: ContactPhone) => void; onMessage: (contact: ContactPhone) => void; onVideoMeeting: () => void }) {
  const insets = useSafeAreaInsets();
  const [permission, setPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [contacts, setContacts] = useState<ContactPhone[]>([]);
  const { profile } = useAuth();
  const directory = useCallingDirectory(profile?.account_type === 'business', profile?.organization_id, profile?.id);
  const team = useMemo<ContactPhone[]>(() => directory.users.map((user) => ({ id: `team-${user.id}`, name: user.name, number: user.extension, extension: user.extension, photoUrl: user.photoUrl, label: user.department, internal: true })), [directory.users]);
  const [query, setQuery] = useState('');
  const searchRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    setPermission('loading');
    const response = await Contacts.requestPermissionsAsync();
    if (response.status !== 'granted') {
      setPermission('denied');
      return;
    }
    const result = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Image], sort: Contacts.SortTypes.FirstName });
    const rows = result.data.flatMap((contact) => (contact.phoneNumbers ?? []).map((phone, index) => ({
      id: `${contact.id}-${phone.id ?? index}`,
      name: contact.name || phone.number || 'Unnamed contact',
      number: cleanNumber(phone.number ?? ''),
      label: phone.label,
      countryCode: phone.countryCode,
      photoUrl: contact.image?.uri,
    }))).filter((contact) => contact.number.length >= 4);
    setContacts(rows);
    setPermission('granted');
  }, []);

  useEffect(() => { load().catch(() => setPermission('denied')); }, [load]);

  const filtered = useMemo(() => {
    const value = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const all = [...team, ...contacts];
    if (!value) return all;
    const digits = value.replace(/\D/g, '');
    return all.filter((contact) => contact.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(value) || (!!digits && contact.number.replace(/\D/g, '').includes(digits)));
  }, [contacts, query, team]);

  return (
    <View style={[styles.page, { paddingTop: Math.max(insets.top, 18) }]}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>PHONE BOOK</Text><Text style={styles.title}>Contacts</Text></View><View style={styles.headerActions}><View style={styles.count}><Text style={styles.countText}>{contacts.length + team.length}</Text></View><Pressable accessibilityLabel="Open video meetings" onPress={onVideoMeeting} style={styles.searchButton}><Video size={19} color={colors.blue} /></Pressable><Pressable accessibilityLabel="Search contacts" onPress={() => searchRef.current?.focus()} style={styles.searchButton}><Search size={19} color={colors.textMuted} /></Pressable></View></View>
      <View style={styles.search}><Search size={18} color={colors.textFaint} /><TextInput ref={searchRef} value={query} onChangeText={setQuery} placeholder="Search name or number" placeholderTextColor={colors.textFaint} style={styles.searchInput} autoCorrect={false} returnKeyType="search" /></View>

      {permission === 'loading' && !team.length ? <View style={styles.center}><ActivityIndicator color={colors.mint} /><Text style={styles.loadingText}>Loading your contacts...</Text></View> : permission === 'denied' && !team.length ? (
        <View style={styles.center}><View style={styles.emptyIcon}><ShieldCheck size={30} color={colors.textFaint} /></View><Text style={styles.emptyTitle}>Contacts access is off</Text><Text style={styles.emptyBody}>Allow Contacts in iPhone Settings to call and message people from Vocivo.</Text><Pressable onPress={() => Linking.openSettings()} style={styles.allowButton}><Text style={styles.allowText}>Open iPhone Settings</Text></Pressable></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={filtered.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<View style={styles.center}><View style={styles.emptyIcon}><ContactRound size={30} color={colors.textFaint} /></View><Text style={styles.emptyTitle}>{query ? 'No matching contacts' : 'No phone numbers found'}</Text><Text style={styles.emptyBody}>Contacts with phone numbers will appear here.</Text></View>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.photoUrl ? <Image source={{ uri: item.photoUrl }} style={styles.avatarPhoto} /> : <View style={[styles.avatar, item.internal && styles.teamAvatar]}><Text style={styles.initial}>{item.name.charAt(0).toUpperCase()}</Text></View>}
              <View style={styles.details}><Text numberOfLines={1} style={styles.name}>{item.name}</Text><Text numberOfLines={1} style={styles.number}>{item.internal ? `Extension ${item.extension} · ${item.label || 'Company'}` : `${item.number}${item.label ? `  ·  ${item.label}` : ''}`}</Text></View>
              <Pressable accessibilityLabel={`Message ${item.name}`} onPress={() => onMessage(item)} style={styles.action}><MessageSquareText size={19} color={colors.blue} /></Pressable>
              <Pressable accessibilityLabel={`Call ${item.name}`} onPress={() => onCall(item)} style={[styles.action, styles.callAction]}><Phone size={18} color={colors.mint} /></Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 20, backgroundColor: colors.ink },
  header: { minHeight: 74, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.mint, fontSize: 10, fontWeight: '800' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 3 },
  count: { minWidth: 38, height: 32, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  countText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchButton: { width: 38, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  search: { height: 44, marginVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 8, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  avatar: { width: 40, height: 40, marginRight: 11, borderRadius: 8, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' },
  avatarPhoto: { width: 40, height: 40, marginRight: 11, borderRadius: 20, backgroundColor: colors.panelRaised },
  teamAvatar: { backgroundColor: '#164361', borderWidth: 1, borderColor: colors.blue },
  initial: { color: colors.text, fontSize: 15, fontWeight: '800' },
  details: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  number: { color: colors.textMuted, fontSize: 11, marginTop: 5 },
  action: { width: 40, height: 40, marginLeft: 3, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101C27' },
  callAction: { backgroundColor: '#12334A' },
  center: { flex: 1, minHeight: 280, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 12, marginTop: 12 },
  emptyIcon: { width: 62, height: 62, marginBottom: 16, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  allowButton: { height: 40, marginTop: 18, paddingHorizontal: 18, borderRadius: 8, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  allowText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
});
