/**
 * PERSONAS ON THIS DEVICE — the restore picker (and any time): the person's personas this device does not run yet
 * (`listReceivablePersonas`), ticked, then handed over with the phrase typed here (`receivePersonas`, the one moment
 * the root is in hand). A restart runs them. Nothing ticked hands over only the recovery seal (a device enrolled before it
 * existed gets it this way). Above it, the selves this device HOLDS, each with its one act (pause / resume —
 * `personasHere.js`'s rows). Web parity: `showReceivePersonas` in circleApp.js — the same ops, the same words; this file
 * only paints.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { personasHereRows } from '../../../../basis/src/v2/personasHere.js';

export default function ReceivePersonasModal({ visible, callSkill, onClose }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [listed, setListed] = useState(null);   // null = loading
  const [needsSeal, setNeedsSeal] = useState(false);   // no recovery seal here yet: the step runs with nothing to tick
  const [picked, setPicked] = useState(() => new Set());
  const [phrase, setPhrase] = useState('');
  const [result, setResult] = useState(null);   // null | 'done' | 'done-seal' | 'paused' | 'resumed' | 'wrong' | 'failed'
  const [here, setHere] = useState([]);   // the selves this device holds (`listPersonasHere`), as the shared rows
  const [actedName, setActedName] = useState('');   // the persona the last pause/resume was for (its done line names it)
  const [removing, setRemoving] = useState(null);   // the row being removed (its warning + the phrase), or null
  const [removePhrase, setRemovePhrase] = useState('');
  useEffect(() => {
    if (!visible || typeof callSkill !== 'function') return;
    let alive = true;
    setListed(null); setPicked(new Set()); setPhrase(''); setResult(null); setNeedsSeal(false);
    callSkill('household', 'listPersonasHere', {})
      .then((r) => { if (alive) setHere(personasHereRows(r?.personas ?? [])); })
      .catch(() => { if (alive) setHere([]); });
    callSkill('household', 'listReceivablePersonas', {})
      .then((r) => { if (alive) { setListed(r?.personas ?? []); setNeedsSeal(r?.hasRecoverySeal === false); } })
      .catch(() => { if (alive) setListed([]); });
    return () => { alive = false; };
  }, [visible, callSkill]);
  if (!visible) return null;

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = async () => {
    const r = await callSkill('household', 'receivePersonas', { mnemonic: phrase, personas: [...picked] }).catch(() => null);
    setPhrase('');
    setResult(r?.ok ? (picked.size ? 'done' : 'done-seal') : (r?.outcome === 'wrong-phrase' || r?.outcome === 'invalid-phrase') ? 'wrong' : 'failed');
  };

  // a row's one act — pause a running persona, resume a paused one (a device op, no phrase; the next boot takes it)
  const act = async (row) => {
    const r = await callSkill('household', row.act.op, { personaId: row.id }).catch(() => null);
    setActedName(row.nameKey ? t(row.nameKey) : row.name);
    setResult(r?.ok ? (row.act.op === 'pausePersona' ? 'paused' : 'resumed') : 'failed');
  };
  // REMOVE — a ceremony: the warning, the phrase, then the act (the shared row names the op)
  const remove = async () => {
    const row = removing;
    const r = await callSkill('household', row.remove.op, { mnemonic: removePhrase, personaId: row.id }).catch(() => null);
    setRemovePhrase(''); setRemoving(null);
    setActedName(row.nameKey ? t(row.nameKey) : row.name);
    if (r?.ok && r.rekeyedTo) { setActedName(here.find((h) => h.id === r.rekeyedTo)?.name ?? r.rekeyedTo); setResult('rekeyed'); return; }
    if (r?.rekeyFailed) { setResult('rekey-failed'); return; }
    setResult(r?.ok ? 'removed' : (r?.outcome === 'wrong-phrase' || r?.outcome === 'invalid-phrase') ? 'wrong'
      : r?.error === 'key-holder' ? 'key-holder' : r?.error === 'paused' ? 'remove-paused' : 'failed');
  };
  const message = result === 'done' ? t('circle.receive_personas.done_reload')
    // what still holds until the restart (the restart hint is the line itself on a phone)
    : result === 'paused' ? t('circle.receive_personas.done_pause_reload', { name: actedName })
    : result === 'resumed' ? t('circle.receive_personas.done_resume_reload')
    : result === 'removed' ? t('circle.receive_personas.done_remove_reload', { name: actedName })
    // re-keyed: every wrapper in memory holds the old key — the phone must be closed and opened again (no way out but that)
    : result === 'rekeyed' ? t('circle.receive_personas.done_rekey_restart', { name: actedName })
    : result === 'rekey-failed' ? t('circle.receive_personas.remove_rekey_failed')
    : result === 'key-holder' ? t('circle.receive_personas.remove_key_holder')
    : result === 'remove-paused' ? t('circle.receive_personas.remove_paused')
    : result === 'done-seal' ? t('circle.receive_personas.done_seal_reload')
    : result === 'wrong' ? t('circle.receive_personas.wrong_phrase')
      : result === 'failed' ? t('circle.receive_personas.failed')
        : (listed && listed.length === 0 && !needsSeal) ? t('circle.receive_personas.none') : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={result === 'rekeyed' ? () => {} : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('circle.receive_personas.title')}</Text>
          {removing ? (
            <View testID="personas-here-removing">
              <Text style={styles.body}>{t(removing.remove.warnKey, { name: removing.nameKey ? t(removing.nameKey) : removing.name })}</Text>
              <TextInput
                style={[styles.input, styles.secret]}
                placeholder={t('circle.receive_personas.phrase_placeholder')}
                placeholderTextColor={theme.color.inkSoft}
                multiline autoCapitalize="none" autoCorrect={false} autoComplete="off"
                value={removePhrase} onChangeText={setRemovePhrase}
                testID="personas-here-remove-phrase"
              />
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={remove} testID="personas-here-remove-go">
                  <Text style={styles.buttonText}>{t('circle.receive_personas.remove_submit')}</Text>
                </Pressable>
                <Pressable style={styles.cancel} onPress={() => { setRemoving(null); setRemovePhrase(''); }}>
                  <Text style={styles.cancelText}>{t('circle.receive_personas.close')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {!removing && !result && here.length ? (
            <View testID="personas-here">
              <Text style={styles.body}>{t('circle.receive_personas.here_title')}</Text>
              {here.map((row) => (
                <View key={row.id} style={styles.row} testID={`personas-here-${row.id}`}>
                  <Text style={styles.body}>{row.nameKey ? t(row.nameKey) : row.name}{row.stateKey ? ` — ${t(row.stateKey)}` : ''}</Text>
                  {row.act ? (
                    <Pressable style={styles.button} onPress={() => act(row)} testID={`personas-here-${row.id}-${row.act.op}`}>
                      <Text style={styles.buttonText}>{t(row.act.labelKey)}</Text>
                    </Pressable>
                  ) : null}
                  {row.remove ? (
                    <Pressable style={styles.button} onPress={() => setRemoving(row)} testID={`personas-here-${row.id}-remove`}>
                      <Text style={styles.buttonText}>{t(row.remove.labelKey)}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          {removing ? null : message ? (
            <View>
              <Text style={styles.body}>{message}</Text>
              {result !== 'rekeyed' ? (
                <Pressable style={styles.cancel} onPress={onClose} testID="receive-personas-close">
                  <Text style={styles.cancelText}>{t('circle.receive_personas.close')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : listed ? (
            <View>
              <Text style={styles.body}>{t('circle.receive_personas.receive_title')}</Text>
              <Text style={styles.body}>{t(listed.length ? 'circle.receive_personas.body' : 'circle.receive_personas.needs_seal')}</Text>
              {listed.map((p) => (
                <Pressable key={p.id} onPress={() => toggle(p.id)} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(p.id) }} testID={`receive-persona-${p.id}`}>
                  <Text style={styles.body}>{picked.has(p.id) ? '☑' : '☐'} {p.name ?? p.id}</Text>
                </Pressable>
              ))}
              {listed.length ? <Text style={styles.body}>{t('circle.receive_personas.seal_only')}</Text> : null}
              <TextInput
                style={[styles.input, styles.secret]}
                placeholder={t('circle.receive_personas.phrase_placeholder')}
                placeholderTextColor={theme.color.inkSoft}
                multiline autoCapitalize="none" autoCorrect={false} autoComplete="off"
                value={phrase} onChangeText={setPhrase}
                testID="receive-personas-phrase"
              />
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={submit} testID="receive-personas-submit">
                  <Text style={styles.buttonText}>{t('circle.receive_personas.submit')}</Text>
                </Pressable>
                <Pressable style={styles.cancel} onPress={onClose}>
                  <Text style={styles.cancelText}>{t('circle.receive_personas.close')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: theme.color.card, borderRadius: 10, padding: 18 },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  body: { fontSize: 14, color: theme.color.ink, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, color: theme.color.ink, marginBottom: 8 },
  secret: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  buttonText: { color: theme.color.ink, fontSize: 14 },
  cancel: { paddingVertical: 8, paddingHorizontal: 6 },
  cancelText: { color: theme.color.inkSoft, fontSize: 14 },
});
