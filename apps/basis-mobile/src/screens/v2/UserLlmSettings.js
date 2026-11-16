/**
 * UserLlmSettings (RN) — the member's PERSONAL assistant endpoint config, mobile parity with web's
 * `userLlmSettings.js`. Lets a member point the circle assistant at their OWN LLM + embedder from the
 * app settings: a posture preset + the LLM base URL/model + the embedder base URL/model + an optional
 * API key (+ an attestation checkbox for the confidential preset). The confidential-route guard
 * (`validate`) runs before save, so a "confidential" preset can't reach a host that could read raw text.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import ThemedTextInput from './ThemedTextInput.js';   // every text input's colours come from the theme (lint-themed-inputs)

const PRESETS = ['off', 'local-ollama', 'confidential-proxy', 'openai-compatible'];

export default function UserLlmSettings({ current = {}, onSave, validate }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [cfg, setCfg] = useState({
    preset: PRESETS.includes(current.preset) ? current.preset : 'off',
    llmBaseUrl: current.llmBaseUrl || '', llmModel: current.llmModel || '',
    embedBaseUrl: current.embedBaseUrl || '', embedModel: current.embedModel || '',
    apiKey: current.apiKey || '', attestation: !!current.attestation,
  });
  const [msg, setMsg] = useState(null);   // { text, error }
  const [busy, setBusy] = useState(false);
  const patch = (p) => { setCfg((c) => ({ ...c, ...p })); setMsg(null); };

  const onSavePress = async () => {
    setMsg(null);
    const err = typeof validate === 'function' ? validate(cfg) : null;
    if (err) { setMsg({ text: err, error: true }); return; }
    setBusy(true);
    let applyErr = null;
    try { applyErr = typeof onSave === 'function' ? await onSave({ ...cfg }) : null; }
    catch (e) { applyErr = e?.message || String(e); }
    setBusy(false);
    setMsg(applyErr ? { text: applyErr, error: true } : { text: t('circle.userLlm.saved'), error: false });
  };

  const field = (key, labelKey, { placeholder = '', secure = false } = {}) => (
    <View style={styles.field} key={key}>
      <Text style={styles.cap}>{t(labelKey)}</Text>
      <ThemedTextInput
        style={styles.input}
        value={cfg[key]}
        onChangeText={(v) => patch({ [key]: v })}
        placeholder={placeholder}
        placeholderTextColor={theme.color.inkSoft}
        autoCapitalize="none" autoCorrect={false} secureTextEntry={secure}
      />
    </View>
  );

  return (
    <View style={styles.wrap} testID="user-llm-settings">
      <Text style={styles.hint}>{t('circle.userLlm.hint')}</Text>

      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable
            key={p}
            testID={`user-llm-preset-${p}`}
            style={[styles.preset, cfg.preset === p && styles.presetActive]}
            onPress={() => patch({ preset: p })}
          >
            <Text style={[styles.presetText, cfg.preset === p && styles.presetTextActive]}>{t(`circle.userLlm.preset.${p}`)}</Text>
          </Pressable>
        ))}
      </View>

      {cfg.preset !== 'off' && (
        <View>
          {field('llmBaseUrl', 'circle.userLlm.llmBaseUrl', { placeholder: 'http://localhost:11434' })}
          {field('llmModel', 'circle.userLlm.llmModel', { placeholder: 'qwen2.5:7b-instruct' })}
          {field('embedBaseUrl', 'circle.userLlm.embedBaseUrl', { placeholder: t('circle.userLlm.embedBaseUrl_ph') })}
          {field('embedModel', 'circle.userLlm.embedModel', { placeholder: 'qwen3-embedding-4b' })}
          {field('apiKey', 'circle.userLlm.apiKey', { secure: true })}
          {cfg.preset === 'confidential-proxy' && (
            <Pressable style={styles.attest} onPress={() => patch({ attestation: !cfg.attestation })} testID="user-llm-attestation">
              <View style={[styles.checkbox, cfg.attestation && styles.checkboxOn]}>{cfg.attestation ? <Text style={styles.check}>✓</Text> : null}</View>
              <Text style={styles.attestText}>{t('circle.userLlm.attestation')}</Text>
            </Pressable>
          )}
        </View>
      )}

      {msg ? <Text style={[styles.msg, msg.error ? styles.msgError : styles.msgOk]}>{msg.text}</Text> : null}

      <Pressable style={[styles.save, busy && styles.saveBusy]} onPress={onSavePress} disabled={busy} testID="user-llm-save">
        <Text style={styles.saveText}>{t('circle.userLlm.save')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { paddingVertical: 12 },
  title: { fontSize: 16, fontWeight: '700', color: theme.color.ink },
  hint: { fontSize: 13, color: theme.color.inkSoft, marginTop: 4, marginBottom: 10 },
  presets: { marginBottom: 8 },
  preset: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.color.line, marginBottom: 6 },
  presetActive: { borderColor: theme.color.accent, backgroundColor: theme.color.paper2 },
  presetText: { color: theme.color.ink, fontSize: 14 },
  presetTextActive: { color: theme.color.accent, fontWeight: '700' },
  field: { marginBottom: 8 },
  cap: { fontSize: 12, color: theme.color.inkSoft, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: theme.color.ink, backgroundColor: theme.color.paper },
  attest: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: theme.color.line, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkboxOn: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  check: { color: '#fff', fontSize: 13, fontWeight: '700' },
  attestText: { flex: 1, fontSize: 13, color: theme.color.ink },
  msg: { marginTop: 8, fontSize: 13 },
  msgError: { color: theme.color.danger ?? '#b3261e' },
  msgOk: { color: theme.color.accent },
  save: { marginTop: 12, backgroundColor: theme.color.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveBusy: { opacity: 0.6 },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
