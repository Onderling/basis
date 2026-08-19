/**
 * MessageScreen — Group D.
 *
 * Per-peer chat screen. Sends via invokeWithHop so messages route through
 * a relay peer if the target is not directly reachable.
 *
 * Shows a hop badge on each sent message so you can see the routing path.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Parts }           from '@onderling/core';
import { useAgent }        from '../context/AgentContext';
import { messageStore }    from '../store/messages.js';
// Hop-aware invoke lives on Agent now (see CODING-PLAN.md Group N).

// ── Screen ────────────────────────────────────────────────────────────────────

export function MessageScreen({ route }) {
  const { pubKey, label } = route.params;
  const { agent }         = useAgent();

  const [messages, setMessages] = useState(() => messageStore.get(pubKey));
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const listRef = useRef(null);

  // ── Subscribe to incoming messages ────────────────────────────────────────
  useEffect(() => {
    function onMessage({ peerPubKey }) {
      if (peerPubKey !== pubKey) return;
      setMessages([...messageStore.get(pubKey)]);
    }
    messageStore.on('message', onMessage);
    return () => messageStore.off('message', onMessage);
  }, [pubKey]);

  // ── Scroll to bottom on new message ───────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !agent || sending) return;

    setInput('');
    setSending(true);

    // Determine routing before sending so we can show the hop badge immediately
    const peerRecord = await agent.peers?.get(pubKey).catch(() => null);
    const hops       = peerRecord?.reachable ? (peerRecord.hops ?? 0) : 1;
    const via        = hops > 0 ? (peerRecord?.via ?? null) : null;

    // Optimistic: add the outgoing message immediately
    const outMsg = messageStore.add(pubKey, {
      direction: 'out',
      text,
      hops,
      via,
      status: 'sending',
    });
    setMessages([...messageStore.get(pubKey)]);

    try {
      await agent.invokeWithHop(pubKey, 'receive-message',
        [{ type: 'TextPart', text }],
        { timeout: 10_000 },
      );
      // Mark as delivered — mutate the entry in the store
      outMsg.status = 'ok';
    } catch (err) {
      outMsg.status = 'err';
      outMsg.error  = err.message;
    } finally {
      setSending(false);
      setMessages([...messageStore.get(pubKey)]);
    }
  }, [input, agent, pubKey, sending]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={s.root}
      behaviour={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Peer info bar */}
      <View style={s.peerBar}>
        <Text style={s.peerLabel} numberOfLines={1}>{label}</Text>
        <Text style={s.peerMono} numberOfLines={1}>{pubKey.slice(0, 22)}…</Text>
      </View>

      {/* Message list */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.dim}>No messages yet. Say hello!</Text>
          </View>
        }
        renderItem={({ item }) => <MessageBubble msg={item} />}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Input row */}
      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message…"
          placeholderTextColor="#6b7094"
          onSubmitEditing={send}
          returnKeyType="send"
          editable={!sending}
          multiline={false}
        />
        <TouchableOpacity
          style={[s.sendBtn, (!input.trim() || sending) && s.sendBtnDim]}
          onPress={send}
          disabled={!input.trim() || sending}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.sendBtnText}>Send</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'out';

  return (
    <View style={[s.bubbleWrap, isOut && s.bubbleWrapOut]}>
      <View style={[s.bubble, isOut ? s.bubbleOut : s.bubbleIn]}>
        <Text style={[s.bubbleText, isOut && s.bubbleTextOut]}>
          {msg.text}
        </Text>

        {/* Status / hop info */}
        <View style={s.bubbleMeta}>
          {msg.status === 'sending' && (
            <Text style={s.metaDim}>sending…</Text>
          )}
          {msg.status === 'err' && (
            <Text style={s.metaErr}>failed</Text>
          )}
          {msg.status === 'ok' && msg.hops === 0 && (
            <Text style={s.metaOk}>direct ✓</Text>
          )}
          {msg.status === 'ok' && msg.hops > 0 && (
            <Text style={s.metaHop}>
              {msg.hops} hop{msg.hops > 1 ? 's' : ''}
              {msg.via ? ` via ${msg.via.slice(0, 8)}…` : ''} ✓
            </Text>
          )}
          {/* Verified-origin badge on incoming messages that carried a
              signature from the originator (Group Z).  Only shown when the
              hop went through a bridge, since direct messages are always
              authenticated by the sealed envelope. */}
          {!isOut && msg.originVerified && msg.relayedBy && (
            <Text style={s.metaVerified}>🔒 verified</Text>
          )}
          <Text style={s.metaTime}>
            {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#0f1117' },

  peerBar:       { padding: 12, paddingHorizontal: 16, backgroundColor: '#141720', borderBottomWidth: 1, borderBottomColor: '#2d3048' },
  peerLabel:     { color: '#d4d8f0', fontSize: 14, fontWeight: '600' },
  peerMono:      { color: '#6b7094', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },

  listContent:   { padding: 12, gap: 6, flexGrow: 1 },

  empty:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  dim:           { color: '#6b7094', fontSize: 13 },

  bubbleWrap:    { alignItems: 'flex-start', marginVertical: 2 },
  bubbleWrapOut: { alignItems: 'flex-end' },
  bubble:        { maxWidth: '80%', borderRadius: 12, padding: 10, paddingHorizontal: 14 },
  bubbleIn:      { backgroundColor: '#1a1d27', borderWidth: 1, borderColor: '#2d3048', borderBottomLeftRadius: 4 },
  bubbleOut:     { backgroundColor: '#2d3470', borderBottomRightRadius: 4 },
  bubbleText:    { color: '#d4d8f0', fontSize: 15, lineHeight: 21 },
  bubbleTextOut: { color: '#e8eaff' },
  bubbleMeta:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },

  metaDim:       { color: '#6b7094', fontSize: 10 },
  metaErr:       { color: '#e05c5c', fontSize: 10 },
  metaOk:        { color: '#4caf82', fontSize: 10 },
  metaHop:       { color: '#e0b860', fontSize: 10 },
  metaVerified:  { color: '#7ba8ff', fontSize: 10 },
  metaTime:      { color: '#6b7094', fontSize: 10, marginLeft: 'auto' },

  inputRow:      { flexDirection: 'row', padding: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#2d3048', backgroundColor: '#141720', alignItems: 'flex-end', gap: 8 },
  input:         { flex: 1, backgroundColor: '#1a1d27', borderWidth: 1, borderColor: '#2d3048', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#d4d8f0', fontSize: 15, maxHeight: 100 },
  sendBtn:       { backgroundColor: '#5b6af9', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, justifyContent: 'center', minWidth: 66 },
  sendBtnDim:    { opacity: 0.45 },
  sendBtnText:   { color: '#fff', fontWeight: '600', fontSize: 14, textAlign: 'center' },
});
