import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AlertCircle, ArrowLeft, Check, ContactRound, Inbox, MessageSquareText, PenLine, Search, Send, SendHorizontal, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMessaging } from '../context/MessagingContext';
import { useBusiness } from '../context/BusinessContext';
import type { NavigationTarget, SmsMessage } from '../types';
import { colors } from '../theme';

type Mailbox = 'inbox' | 'sent';
type Thread = { peer: string; name?: string; messages: SmsMessage[]; latest: SmsMessage; inbound: boolean; outbound: boolean };

const compactNumber = (value: string) => value.replace(/[\s()-]/g, '');
const peerFor = (message: SmsMessage) => compactNumber(message.direction === 'inbound' ? (message.from || message.to) : message.to);
const stamp = (value: string) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function MessagesScreen({ target, onContacts }: { target: NavigationTarget | null; onContacts: () => void }) {
  const insets = useSafeAreaInsets();
  const { messages, loading, refreshMessages, sendMessage, suggestReplies } = useMessaging();
  const { profile: business } = useBusiness();
  const [mailbox, setMailbox] = useState<Mailbox>('inbox');
  const [activePeer, setActivePeer] = useState('');
  const [recipient, setRecipient] = useState('');
  const [contactName, setContactName] = useState('');
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (!target) return;
    const number = compactNumber(target.number);
    setRecipient(number);
    setActivePeer(number);
    setContactName(target.name ?? '');
    setError('');
  }, [target]);

  useEffect(() => {
    refreshMessages().catch(() => undefined);
    const timer = setInterval(() => refreshMessages().catch(() => undefined), 15000);
    return () => clearInterval(timer);
  }, [refreshMessages]);

  const threads = useMemo(() => {
    const groups = new Map<string, SmsMessage[]>();
    messages.forEach((message) => {
      const peer = peerFor(message);
      if (!peer) return;
      groups.set(peer, [...(groups.get(peer) ?? []), message]);
    });
    return [...groups.entries()].map(([peer, items]): Thread => {
      const sorted = [...items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return {
        peer,
        name: sorted.find((item) => item.contactName)?.contactName,
        messages: sorted,
        latest: sorted[0]!,
        inbound: sorted.some((item) => item.direction === 'inbound'),
        outbound: sorted.some((item) => item.direction === 'outbound'),
      };
    }).sort((a, b) => +new Date(b.latest.createdAt) - +new Date(a.latest.createdAt));
  }, [messages]);

  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads.filter((thread) => (mailbox === 'inbox' ? thread.inbound : thread.outbound))
      .filter((thread) => !needle || `${thread.name ?? ''} ${thread.peer} ${thread.latest.text}`.toLowerCase().includes(needle));
  }, [mailbox, query, threads]);

  const conversation = useMemo(() => {
    if (!activePeer) return [];
    return messages.filter((message) => peerFor(message) === activePeer)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [activePeer, messages]);

  const openThread = (thread: Thread) => {
    setActivePeer(thread.peer);
    setRecipient(thread.peer);
    setContactName(thread.name ?? '');
    setBody('');
    setError('');
  };

  const compose = () => {
    setActivePeer('new');
    setRecipient('');
    setContactName('');
    setBody('');
    setError('');
  };

  const closeThread = () => {
    setActivePeer('');
    setRecipient('');
    setContactName('');
    setSuggestions([]);
    setError('');
    Keyboard.dismiss();
  };

  const canSend = /^\+[1-9]\d{6,14}$/.test(compactNumber(recipient)) && body.trim().length > 0 && !sending;
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setError('');
    try {
      const normalized = compactNumber(recipient);
      await sendMessage(normalized, body, contactName || undefined);
      setRecipient(normalized);
      setActivePeer(normalized);
      setBody('');
      setSuggestions([]);
      Keyboard.dismiss();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const getSuggestions = async () => {
    if (!body.trim() && !conversation.length) {
      setError('Write a short draft first so AI knows what you want to say.');
      return;
    }
    setSuggesting(true);
    setError('');
    try {
      setSuggestions(await suggestReplies({
        draft: body,
        recipient: contactName || recipient,
        companyName: business.enabled ? business.companyName : undefined,
        tone: business.aiTone,
        context: conversation.slice(0, 6).map((message) => message.text),
      }));
    } catch (suggestError) {
      setError(suggestError instanceof Error ? suggestError.message : 'AI responses are unavailable.');
    } finally {
      setSuggesting(false);
    }
  };

  if (activePeer) {
    return (
      <View style={[styles.page, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.conversationHeader}>
          <Pressable accessibilityLabel="Back to messages" onPress={closeThread} style={styles.iconButton}><ArrowLeft size={21} color={colors.text} /></Pressable>
          <View style={styles.conversationIdentity}><Text numberOfLines={1} style={styles.conversationName}>{contactName || (activePeer === 'new' ? 'New message' : activePeer)}</Text>{!!contactName && <Text style={styles.conversationNumber}>{recipient}</Text>}</View>
          <Pressable accessibilityLabel="Choose from contacts" onPress={onContacts} style={styles.iconButton}><ContactRound size={20} color={colors.blue} /></Pressable>
        </View>
        {(activePeer === 'new' || !recipient) && <View style={styles.recipientRow}><Text style={styles.to}>TO</Text><TextInput autoFocus value={recipient} onChangeText={(value) => { setRecipient(value); setContactName(''); }} keyboardType="phone-pad" placeholder="+966 50 123 4567" placeholderTextColor={colors.textFaint} style={styles.recipient} /></View>}
        <View style={styles.history}>
          {loading && !messages.length ? <ActivityIndicator color={colors.blue} style={styles.loader} /> : <FlatList data={conversation} inverted keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={conversation.length ? styles.messageList : styles.emptyList} ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}><MessageSquareText size={30} color={colors.textFaint} /></View><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptyBody}>Messages use full international numbers beginning with +.</Text></View>} renderItem={({ item }) => <View style={[styles.message, item.direction === 'inbound' && styles.messageInbound]}><Text style={styles.messageText}>{item.text}</Text><View style={styles.messageMeta}><Text style={styles.messageTime}>{stamp(item.createdAt)}</Text>{item.status === 'failed' ? <AlertCircle size={12} color={colors.coral} /> : item.direction === 'outbound' ? <Check size={13} color={colors.mint} /> : null}</View>{item.error && <Text style={styles.messageError}>{item.error}</Text>}</View>} />}
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!suggestions.length && <View style={styles.suggestions}>{suggestions.map((suggestion, index) => <Pressable key={`${index}-${suggestion}`} onPress={() => { setBody(suggestion); setSuggestions([]); }} style={styles.suggestion}><Sparkles size={13} color={colors.blue} /><Text numberOfLines={3} style={styles.suggestionText}>{suggestion}</Text></Pressable>)}</View>}
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Pressable accessibilityLabel="Generate AI reply" onPress={getSuggestions} style={styles.ai}>{suggesting ? <ActivityIndicator color={colors.blue} /> : <Sparkles size={19} color={colors.blue} />}</Pressable>
          <TextInput value={body} onChangeText={setBody} multiline maxLength={1600} placeholder="Message" placeholderTextColor={colors.textFaint} style={styles.body} />
          <Pressable accessibilityLabel="Send message" disabled={!canSend} onPress={submit} style={[styles.send, !canSend && styles.sendDisabled]}>{sending ? <ActivityIndicator color={colors.ink} /> : <Send size={20} color={colors.ink} fill={colors.ink} />}</Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.page, { paddingTop: Math.max(insets.top, 18) }]}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>GLOBAL MESSAGING</Text><Text style={styles.title}>Messages</Text></View><Pressable accessibilityLabel="New message" onPress={compose} style={styles.compose}><PenLine size={20} color={colors.ink} /></Pressable></View>
      <View style={styles.mailboxes}>
        <Pressable onPress={() => setMailbox('inbox')} style={[styles.mailbox, mailbox === 'inbox' && styles.mailboxActive]}><Inbox size={17} color={mailbox === 'inbox' ? colors.blue : colors.textMuted} /><Text style={[styles.mailboxText, mailbox === 'inbox' && styles.mailboxTextActive]}>Inbox</Text></Pressable>
        <Pressable onPress={() => setMailbox('sent')} style={[styles.mailbox, mailbox === 'sent' && styles.mailboxActive]}><SendHorizontal size={17} color={mailbox === 'sent' ? colors.blue : colors.textMuted} /><Text style={[styles.mailboxText, mailbox === 'sent' && styles.mailboxTextActive]}>Sent</Text></Pressable>
      </View>
      <View style={styles.searchBox}><Search size={18} color={colors.textFaint} /><TextInput value={query} onChangeText={setQuery} placeholder="Search messages" placeholderTextColor={colors.textFaint} style={styles.searchInput} /></View>
      {loading && !messages.length ? <ActivityIndicator color={colors.blue} style={styles.loader} /> : <FlatList data={visibleThreads} keyExtractor={(item) => item.peer} contentContainerStyle={visibleThreads.length ? styles.threadList : styles.emptyList} ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}>{mailbox === 'inbox' ? <Inbox size={30} color={colors.textFaint} /> : <SendHorizontal size={30} color={colors.textFaint} />}</View><Text style={styles.emptyTitle}>{mailbox === 'inbox' ? 'Your inbox is clear' : 'No sent messages'}</Text><Text style={styles.emptyBody}>International SMS conversations will appear here.</Text></View>} renderItem={({ item }) => <Pressable onPress={() => openThread(item)} style={({ pressed }) => [styles.thread, pressed && styles.threadPressed]}><View style={styles.avatar}><Text style={styles.avatarText}>{(item.name || item.peer).replace('+', '').slice(0, 2).toUpperCase()}</Text></View><View style={styles.threadBody}><View style={styles.threadTop}><Text numberOfLines={1} style={styles.threadName}>{item.name || item.peer}</Text><Text style={styles.threadTime}>{stamp(item.latest.createdAt)}</Text></View><Text numberOfLines={1} style={styles.threadPreview}>{item.latest.direction === 'outbound' ? 'You: ' : ''}{item.latest.text}</Text></View></Pressable>} />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  header: { minHeight: 74, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: '800' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 3 },
  compose: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue },
  mailboxes: { height: 43, marginHorizontal: 20, padding: 3, flexDirection: 'row', borderRadius: 8, backgroundColor: colors.panel },
  mailbox: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  mailboxActive: { backgroundColor: colors.panelRaised },
  mailboxText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' },
  mailboxTextActive: { color: colors.text },
  searchBox: { height: 44, marginHorizontal: 20, marginVertical: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  threadList: { paddingHorizontal: 20, paddingBottom: 30 },
  thread: { minHeight: 76, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  threadPressed: { opacity: 0.65 },
  avatar: { width: 44, height: 44, marginRight: 12, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#143A55' },
  avatarText: { color: colors.blue, fontSize: 12, fontWeight: '900' },
  threadBody: { flex: 1 },
  threadTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  threadName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '800' },
  threadTime: { color: colors.textFaint, fontSize: 10 },
  threadPreview: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  conversationHeader: { minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  conversationIdentity: { flex: 1, alignItems: 'center' },
  conversationName: { maxWidth: '95%', color: colors.text, fontSize: 15, fontWeight: '800' },
  conversationNumber: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  recipientRow: { minHeight: 52, marginHorizontal: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: colors.line },
  to: { color: colors.textFaint, fontSize: 10, fontWeight: '900' },
  recipient: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 },
  history: { flex: 1 },
  loader: { marginTop: 80 },
  messageList: { paddingHorizontal: 20, paddingVertical: 14 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: { paddingHorizontal: 42, paddingBottom: 70, alignItems: 'center' },
  emptyIcon: { width: 62, height: 62, marginBottom: 16, borderRadius: 8, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  message: { alignSelf: 'flex-end', maxWidth: '86%', minWidth: 120, marginVertical: 5, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 8, backgroundColor: '#153C59', borderWidth: 1, borderColor: '#2B6282' },
  messageInbound: { alignSelf: 'flex-start', backgroundColor: colors.panelRaised, borderColor: colors.line },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  messageMeta: { minHeight: 18, marginTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  messageTime: { color: colors.textMuted, fontSize: 9 },
  messageError: { color: colors.coral, fontSize: 9, marginTop: 4 },
  error: { color: colors.coral, fontSize: 11, paddingHorizontal: 20, paddingVertical: 5, textAlign: 'center' },
  suggestions: { maxHeight: 190, paddingHorizontal: 14, paddingTop: 8, gap: 6, backgroundColor: colors.canvas },
  suggestion: { minHeight: 42, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, backgroundColor: '#101C27', borderWidth: 1, borderColor: '#20364A' },
  suggestionText: { flex: 1, color: colors.text, fontSize: 11, lineHeight: 15 },
  composer: { minHeight: 64, paddingTop: 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 9, backgroundColor: colors.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  body: { flex: 1, maxHeight: 110, minHeight: 44, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 8, color: colors.text, fontSize: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  send: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  ai: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#101C27', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#20364A' },
  sendDisabled: { opacity: 0.28 },
});
