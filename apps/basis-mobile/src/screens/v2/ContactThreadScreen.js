/**
 * basis-mobile v2 — contact DM thread (feedback-extension, mobile parity).
 *
 * RN mirror of web's `renderContactThread` + the circleApp DM glue. Sends a turn
 * over the SHARED contact-thread channel (`bundle.contactChannel` → sa.peer →
 * mdns/relay/nkn) and renders the async reply that arrives via the shared
 * `contactReplyInbox` (ChatScreen's peer router pushes into it). Message state is
 * platform glue (React state); the channel contract is shared web≡mobile.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { subscribeContactReplies } from '../../core/contactReplyInbox.js';

export default function ContactThreadScreen({ bundle, contact, onBack }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const channel = bundle?.contactChannel ?? null;
  const registry = bundle?.contactSkills ?? null;
  const contactId = contact?.contactId;
  const peerAddr = contact?.peerAddr ?? contactId;
  const name = contact?.name ?? contactId ?? '';
  // the bot's skills, shown as in-thread quick actions (dispatched to
  // the bot via the registry, distinct from a conversational turn).
  const skills = registry?.skillsFor?.(contactId) ?? [];

  // A thread may open WITH its first lines — the ask that was answered and the answer (Nearby).
  const [messages, setMessages] = useState(() => (Array.isArray(contact?.seed) ? contact.seed : []));
  // Rung 4 (nearby threads): "share how to reach me" + the other side's ask-back bar.
  const room = bundle?.nearbyRoom ?? null;
  const [pendingReach, setPendingReach] = useState(() => room?.pendingReachFrom?.(peerAddr) ?? null);
  useEffect(() => {
    if (typeof room?.subscribeToReach !== 'function') return undefined;
    return room.subscribeToReach((r) => { if (r?.from === peerAddr) setPendingReach(r); });
  }, [room, peerAddr]);
  const shareReach = async (wantBack) => {
    const r = await room?.shareReach?.(peerAddr, { wantBack });
    if (r?.ok) {
      room?.settleReach?.(peerAddr);
      setPendingReach(null);
      setMessages((prev) => [...prev, { id: mkId(), origin: 'user', text: t('circle.nearbyScreen.reach_shared_you') }]);
    }
  };
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const scrollRef = useRef(null);

  // Route inbound replies for THIS thread (by threadId echo, else sender addr).
  useEffect(() => {
    return subscribeContactReplies((reply) => {
      const forThis = (reply.threadId && reply.threadId === contactId) || reply.fromAddr === peerAddr;
      if (!forThis) return;
      setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', text: reply.text ?? '', buttons: reply.buttons }]);
    });
  }, [contactId, peerAddr]);

  // Dispatch a named skill to the bot (registry → sendA2ATask) + append the reply.
  const runSkill = useCallback(async (skillId, args = {}) => {
    if (!registry) return;
    setError(false);
    setMessages((prev) => [...prev, { id: mkId(), origin: 'user', text: `/${skillId}` }]);
    setBusy(true);
    try {
      const res = await registry.callSkill(contactId, skillId, args);
      const text = replyTextFromResult(res);
      if (text) setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', text }]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [registry, contactId]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !channel) return;
    setInput('');
    // `/skill args` → dispatch as a skill; otherwise a conversational turn.
    if (text.startsWith('/')) {
      const sp = text.slice(1).indexOf(' ');
      const skillId = sp === -1 ? text.slice(1) : text.slice(1, sp + 1);
      const rest = sp === -1 ? '' : text.slice(sp + 2).trim();
      if (skills.some((s) => s.id === skillId)) { await runSkill(skillId, rest ? { text: rest } : {}); return; }
    }
    setError(false);
    setMessages((prev) => [...prev, { id: mkId(), origin: 'user', text }]);
    setBusy(true);
    try {
      const { sent } = channel.sendTurn({ peerAddr, threadId: contactId, text });
      await sent;
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [input, channel, peerAddr, contactId, skills, runSkill]);

  return (
    <View style={styles.wrap} testID="contact-thread-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="contact-thread-back">
          <Text style={styles.back}>{t('circle.contacts.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('circle.contacts.thread_title', { name })}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.log}
        contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd?.({ animated: true })}
      >
        {messages.map((m) => (
          <View key={m.id} style={[styles.msg, m.origin === 'user' ? styles.msgUser : styles.msgBot]}>
            <View style={[styles.bubble, m.origin === 'user' ? styles.bubbleUser : styles.bubbleBot]}>
              <Text style={m.origin === 'user' ? styles.bubbleUserText : styles.bubbleBotText} testID={`contact-msg-${m.origin}`}>
                {m.text}
              </Text>
            </View>
          </View>
        ))}
        {busy && <Text style={styles.sending}>{t('circle.contacts.sending')}</Text>}
      </ScrollView>

      {error && <Text style={styles.error}>{t('circle.contacts.send_failed', { name })}</Text>}

      {skills.length > 0 && (
        <View style={styles.skills}>
          {skills.map((sk) => (
            <Pressable
              key={sk.id}
              style={styles.skill}
              onPress={() => runSkill(sk.id)}
              accessibilityRole="button"
              testID={`contact-skill-${sk.id}`}
            >
              <Text style={styles.skillText}>{`/${sk.id}`}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {pendingReach ? (
        <View style={styles.composer} testID="reach-ask-back">
          <Text style={{ flex: 1, color: theme.color.ink, fontSize: 13 }}>
            {t('circle.nearbyScreen.reach_ask_back', { name })}
          </Text>
          <Pressable style={styles.send} onPress={() => shareReach(false)} accessibilityRole="button" testID="reach-back-yes">
            <Text style={styles.sendText}>{t('circle.nearbyScreen.reach_back_yes')}</Text>
          </Pressable>
          <Pressable style={styles.send} onPress={() => { room?.settleReach?.(peerAddr); setPendingReach(null); }} accessibilityRole="button" testID="reach-back-no">
            <Text style={styles.sendText}>{t('circle.nearbyScreen.reach_back_no')}</Text>
          </Pressable>
        </View>
      ) : null}
      {contact?.transient && !pendingReach ? (
        <Pressable onPress={() => shareReach(true)} accessibilityRole="button" testID="reach-share" style={styles.skillChip ?? styles.send}>
          <Text style={styles.sendText}>{t('circle.nearbyScreen.reach_share')}</Text>
        </Pressable>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t('circle.contacts.composer', { name })}
          placeholderTextColor={theme.color.inkSoft}
          onSubmitEditing={onSend}
          testID="contact-thread-input"
        />
        <Pressable style={styles.send} onPress={onSend} accessibilityRole="button" testID="contact-thread-send">
          <Text style={styles.sendText}>{t('circle.contacts.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

let _id = 0;
function mkId() { _id += 1; return `ctm-${_id}`; }

// #13 — human-readable text out of a remote-skill result ({ parts } | { text } | string).
function replyTextFromResult(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  if (typeof res.text === 'string') return res.text;
  const parts = Array.isArray(res.parts) ? res.parts : null;
  if (parts) {
    const text = parts.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).filter(Boolean).join('\n');
    if (text) return text;
  }
  try { return JSON.stringify(res); } catch { return ''; }
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: theme.color.paper },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 8 },
  back: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink },
  log: { flex: 1 },
  msg: { maxWidth: '82%' },
  msgUser: { alignSelf: 'flex-end' },
  msgBot: { alignSelf: 'flex-start' },
  bubble: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  bubbleUser: { backgroundColor: theme.color.accent },
  bubbleBot: { backgroundColor: theme.color.white, borderWidth: 1, borderColor: theme.color.line },
  bubbleUserText: { color: theme.color.white, fontSize: 14, lineHeight: 20 },
  bubbleBotText: { color: theme.color.ink, fontSize: 14, lineHeight: 20 },
  sending: { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', paddingHorizontal: 4 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  skill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.accent },
  skillText: { fontSize: 12, fontWeight: '600', color: theme.color.accent },
  error: { fontSize: 13, color: '#b3261e', paddingVertical: 6 },
  composer: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  send: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  sendText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
});
