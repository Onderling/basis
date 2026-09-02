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
import { Image, View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { createComposerCommands } from '../../../../basis/src/v2/composerCommands.js';
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
  // The typed door, over the SAME seam every other composer uses. What it offers is what this peer
  // exposes — a bot is a contact, so this is also "what can this bot do". Replaced a hand-written
  // `/skill args` parser that did the same job in one place only.
  const commands = useMemo(() => createComposerCommands({ kind: 'contact', skills }), [skills]);

  // A thread may open WITH its first lines — the ask that was answered and the answer (Nearby).
  const [messages, setMessages] = useState(() => (Array.isArray(contact?.seed) ? contact.seed : []));
  // Rehydrate the DURABLE thread on open (web parity — showContactThread does the same): without it a
  // received file existed in the store and the screen opened empty. BOTH keys, because an unsolicited
  // inbound (a peer-wire file, a first DM) persists under the sender's ADDRESS while turns echo the
  // contactId — for a saved contact those differ.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (typeof channel?.rehydrate !== 'function') return;
      try {
        const a = await channel.rehydrate(contactId);
        const b = (peerAddr && peerAddr !== contactId) ? await channel.rehydrate(peerAddr) : [];
        const durable = [...a, ...b].sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0));
        if (!alive || durable.length === 0) return;
        setMessages((prev) => (prev.length ? prev : durable.map((m) => ({
          id: mkId(), origin: m.origin, text: m.text ?? '',
          ...(m.buttons ? { buttons: m.buttons } : {}),
          ...(m.file ? { file: m.file } : {}),
        }))));
      } catch { /* best-effort — an empty thread is the honest fallback */ }
    })();
    return () => { alive = false; };
  }, [channel, contactId, peerAddr]);
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
  // …and what to offer while the command word is being typed (closes as soon as a space is typed).
  const suggestions = useMemo(
    () => (input.startsWith('/') ? commands.suggest(input) : []), [commands, input]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const scrollRef = useRef(null);

  // Route inbound replies for THIS thread (by threadId echo, else sender addr).
  useEffect(() => {
    return subscribeContactReplies((reply) => {
      const forThis = (reply.threadId && reply.threadId === contactId) || reply.fromAddr === peerAddr;
      if (!forThis) return;
      setMessages((prev) => [...prev, {
        id: mkId(), origin: 'bot', text: reply.text ?? '', buttons: reply.buttons,
        ...(reply.file ? { file: reply.file } : {}),
      }]);
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
    // A command this peer offers → dispatch it; anything else (including a `/` line they do not expose)
    // is a conversational turn, because in a conversation a slash is sometimes just a slash.
    const cmd = commands.parse(text);
    if (cmd) { await runSkill(cmd.opId, cmd.rest ? { text: cmd.rest } : {}); return; }
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
  }, [input, channel, peerAddr, contactId, commands, runSkill]);

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
              {/* A received peer-wire file rides the turn — an image shows itself, every file gets
                  its name and size. web≡mobile with contactThread.js's file bubble. */}
              {m.file?.mime?.startsWith?.('image/') && m.file?.dataB64 ? (
                <Image
                  source={{ uri: `data:${m.file.mime};base64,${m.file.dataB64}` }}
                  style={styles.fileImage}
                  resizeMode="cover"
                  testID={`contact-file-image-${m.id}`}
                />
              ) : null}
              {m.file ? (
                <Text style={styles.fileMeta} testID={`contact-file-meta-${m.id}`}>
                  {`📎 ${m.file.name ?? ''}${Number.isFinite(m.file.size) ? ` · ${(m.file.size / 1024).toFixed(0)} KB` : ''}`}
                </Text>
              ) : null}
              {m.text ? (
                <Text style={m.origin === 'user' ? styles.bubbleUserText : styles.bubbleBotText} testID={`contact-msg-${m.origin}`}>
                  {m.text}
                </Text>
              ) : null}
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
      {/* The typed door: what this peer offers, while the command word is being typed. */}
      {suggestions.length > 0 && (
        <View style={styles.suggest} testID="contact-thread-suggest">
          {suggestions.map((e) => (
            <Pressable
              key={e.command}
              onPress={() => setInput(`${e.command} `)}
              accessibilityRole="button"
              testID={`contact-thread-suggest-${e.opId}`}
              style={styles.suggestRow}
            >
              <Text style={styles.suggestCmd}>{e.command}</Text>
              <Text style={styles.suggestHint} numberOfLines={1}>{e.hint}</Text>
            </Pressable>
          ))}
        </View>
      )}
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
  fileImage: { width: 220, height: 160, borderRadius: 8, marginBottom: 6 },
  fileMeta:  { fontSize: 12, opacity: 0.8, marginBottom: 2 },
  sending: { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', paddingHorizontal: 4 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  suggest: { borderTopWidth: 1, borderTopColor: theme.color.line, paddingVertical: 4 },
  suggestRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 6, paddingHorizontal: 12 },
  suggestCmd: { color: theme.color.ink, fontWeight: '600' },
  suggestHint: { color: theme.color.inkSoft, flexShrink: 1 },
  skill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.accent },
  skillText: { fontSize: 12, fontWeight: '600', color: theme.color.accent },
  error: { fontSize: 13, color: '#b3261e', paddingVertical: 6 },
  composer: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  send: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  sendText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
});
