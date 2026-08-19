/**
 * SetupScreen — shown on first launch (or when no relay URL is saved).
 *
 * The relay server is the bridge between the phone and the browser demos.
 * Both must connect to the same relay URL for peers to see each other.
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { saveSettings } from '../store/settings.js';

export function SetupScreen({ onDone }) {
  const [url,     setUrl]     = useState('ws://192.168.1.1:8787');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  async function connect() {
    const trimmed = url.trim();
    if (!trimmed.startsWith('ws://') && !trimmed.startsWith('wss://')) {
      setError('URL must start with ws:// or wss://');
      return;
    }
    setSaving(true);
    try {
      await saveSettings({ relayUrl: trimmed });
      onDone(trimmed);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behaviour={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.inner}>
        <Text style={s.title}>@onderling</Text>
        <Text style={s.sub}>mesh demo</Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>Relay server</Text>
          <Text style={s.cardDesc}>
            Enter the WebSocket URL of your local relay server.{'\n'}
            Start the relay on your laptop with:{'\n'}
          </Text>
          <Text style={s.code}>node start-relay.js</Text>
          <Text style={s.cardDesc}>
            {'\n'}Then use the <Text style={s.bold}>LAN address</Text> it prints
            (e.g. ws://192.168.x.x:8787).{'\n'}
            Browser demo tabs on the same laptop must point to the same URL.
          </Text>

          <TextInput
            style={s.input}
            value={url}
            onChangeText={t => { setUrl(t); setError(null); }}
            placeholder="ws://192.168.x.x:8787"
            placeholderTextColor="#6b7094"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={connect}
          />
          {error && <Text style={s.err}>{error}</Text>}
        </View>

        <TouchableOpacity
          style={[s.btn, saving && s.btnDim]}
          onPress={connect}
          disabled={saving}
        >
          <Text style={s.btnText}>{saving ? 'Connecting…' : 'Connect'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#0f1117' },
  inner:     { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title:     { color: '#5b6af9', fontSize: 28, fontWeight: '800' },
  sub:       { color: '#6b7094', fontSize: 15, marginTop: -10 },
  card:      { width: '100%', backgroundColor: '#1a1d27', borderWidth: 1, borderColor: '#2d3048', borderRadius: 12, padding: 18, gap: 8 },
  cardTitle: { color: '#d4d8f0', fontSize: 14, fontWeight: '700' },
  cardDesc:  { color: '#6b7094', fontSize: 12, lineHeight: 18 },
  bold:      { color: '#d4d8f0', fontWeight: '600' },
  code:      { color: '#4caf82', fontFamily: 'monospace', fontSize: 13, backgroundColor: '#0f1117', padding: 8, borderRadius: 6 },
  input:     { backgroundColor: '#0f1117', borderWidth: 1, borderColor: '#2d3048', borderRadius: 8, color: '#d4d8f0', padding: 12, fontSize: 14, fontFamily: 'monospace', marginTop: 4 },
  err:       { color: '#e05c5c', fontSize: 12 },
  btn:       { width: '100%', backgroundColor: '#5b6af9', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnDim:    { opacity: 0.5 },
  btnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
});
