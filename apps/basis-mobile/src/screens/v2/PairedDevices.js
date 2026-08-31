/**
 * PairedDevices (mobile) — the OBJ-2 no-pod sync pairing panel, RN parity of the web
 * web/v2/pairedDevices.js. Shows THIS device's shareable address (selectable → native
 * copy, no clipboard dep) and add/remove peers by address; items in the circle then sync
 * to them over the relay/peer transport with no pod. Self-manages its peer list from the
 * handlers' returned roster, so the host doesn't re-render the whole settings screen.
 * Uses the SHARED circle.pairedDevices.* locale keys (one source for web + mobile).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { QrCodeView } from '@onderling/react-native/qr/view';
import { useTheme } from './themeContext.js';
import QrScannerModal from '../../rn/QrScannerModal.js';
import { makePairUri, parsePairUri } from '../../../../basis/src/core/qrSchemes.js';
import { translatorOr } from '../../../../basis/src/locales/translatorOr.js';

const short = (a) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export default function PairedDevices({ selfAddr = '', peers: initialPeers = [], t, onAdd, onRemove }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const tr = translatorOr(t, 'PairedDevices.js');
  const [peers, setPeers] = useState(Array.isArray(initialPeers) ? initialPeers : []);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [paired, setPaired] = useState(false);

  // Pair by address (typed, pasted-URI, or scanned). Tolerant of a pasted `onderling-pair://…` payload.
  const pair = async (raw) => {
    const addr = parsePairUri(String(raw ?? '').trim())?.addr;
    if (!addr) return;
    setErr(false); setBusy(true);
    try {
      const next = await onAdd?.(addr);
      setPeers(Array.isArray(next) ? next : [...new Set([...peers, addr])]);
      setDraft('');
      setPaired(true); setTimeout(() => setPaired(false), 1500);
    } catch { setErr(true); }
    setBusy(false);
  };
  const add = () => pair(draft);
  const onScanResult = (res) => {
    if (res && res.kind === 'pair') pair(res.payload);
    else setErr(true);
  };
  const remove = async (addr) => {
    try {
      const next = await onRemove?.(addr);
      setPeers(Array.isArray(next) ? next : peers.filter((p) => p !== addr));
    } catch { setPeers(peers.filter((p) => p !== addr)); }
  };

  return (
    <View testID="paired-devices">
      <Text style={styles.intro}>{tr('circle.pairedDevices.intro')}</Text>

      <Text style={styles.label}>{tr('circle.pairedDevices.yourAddr')}</Text>
      <Text style={styles.addr} selectable testID="paired-self-addr">{selfAddr}</Text>

      {selfAddr ? (
        <View style={styles.qrWrap}>
          <QrCodeView value={makePairUri(selfAddr)} size={180} />
          <Text style={styles.qrHint}>{tr('circle.pairedDevices.qrHint')}</Text>
        </View>
      ) : null}

      <Pressable style={styles.scanBtn} onPress={() => { setErr(false); setScanOpen(true); }} testID="paired-scan-btn" accessibilityRole="button">
        <Text style={styles.scanBtnText}>{tr('circle.pairedDevices.scan')}</Text>
      </Pressable>
      {paired ? <Text style={styles.paired}>{tr('circle.pairedDevices.paired')}</Text> : null}

      <QrScannerModal visible={scanOpen} onClose={() => setScanOpen(false)} onResult={onScanResult} t={tr} />

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={tr('circle.pairedDevices.addPlaceholder')}
          placeholderTextColor={theme.color.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
          testID="paired-add-input"
        />
        <Pressable style={styles.addBtn} onPress={add} disabled={busy} testID="paired-add-btn" accessibilityRole="button">
          <Text style={styles.addBtnText}>{tr('circle.pairedDevices.add')}</Text>
        </Pressable>
      </View>
      {err ? <Text style={styles.err}>{tr('circle.pairedDevices.addFailed')}</Text> : null}

      {peers.length === 0 ? (
        <Text style={styles.empty}>{tr('circle.pairedDevices.empty')}</Text>
      ) : (
        peers.map((addr) => (
          <View key={addr} style={styles.peer} testID="paired-peer">
            <Text style={styles.peerAddr} numberOfLines={1}>{short(addr)}</Text>
            <Pressable onPress={() => remove(addr)} testID="paired-remove" accessibilityRole="button">
              <Text style={styles.remove}>{tr('circle.pairedDevices.remove')}</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  intro:    { fontSize: 13, color: theme.color.inkSoft, marginBottom: 8 },
  label:    { fontSize: 12, fontWeight: '600', color: theme.color.inkSoft, marginBottom: 2 },
  addr:     { fontSize: 13, color: theme.color.ink, fontFamily: 'monospace', backgroundColor: theme.color.card, borderRadius: theme.radius.md, padding: 8, marginBottom: 10 },
  qrWrap:   { alignItems: 'center', marginBottom: 12 },
  qrHint:   { fontSize: 12, color: theme.color.inkSoft, marginTop: 6, textAlign: 'center' },
  scanBtn:  { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.accent, marginBottom: 10 },
  scanBtnText: { color: theme.color.accent, fontSize: 14, fontWeight: '600' },
  paired:   { fontSize: 13, color: theme.color.accent, marginBottom: 8 },
  addRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input:    { flex: 1, fontSize: 14, color: theme.color.ink, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: theme.color.paper },
  addBtn:   { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.accent },
  addBtnText: { color: theme.color.accent, fontSize: 14, fontWeight: '600' },
  err:      { fontSize: 13, color: theme.color.danger ?? '#c0392b', marginTop: 6 },
  empty:    { fontSize: 13, color: theme.color.inkSoft, marginTop: 10 },
  peer:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8, paddingHorizontal: 8, marginTop: 6, borderRadius: theme.radius.md, backgroundColor: theme.color.card },
  peerAddr: { flex: 1, fontSize: 13, color: theme.color.ink, fontFamily: 'monospace' },
  remove:   { fontSize: 13, color: theme.color.inkSoft },
});
