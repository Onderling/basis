/**
 * **Platform: RN**.  Mobile parity for
 * src/web/wizards/settingsWizard.js.
 *
 * NOT a stepper — a settings panel.  Reads stoop profile +
 * holiday-mode via loadSettings, then exposes:
 *   - handle save (stoop.setMyHandle)
 *   - display-name save (stoop.setMyDisplayName)
 *   - holiday-mode toggle (stoop.setHolidayMode)
 *
 * Shares src/core/wizards/settingsState.js with web.
 *
 * Future Bundle F reframes this to a per-app composed settings
 * screen (each app provides its own — see priority doc).  For now
 * this matches web's settingsWizard 1:1.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable, Text, TouchableOpacity } from 'react-native';

import {
  initialState, loadSettings,
  saveHandle, saveDisplayName, setHolidayMode,
} from '../../core/wizards/settingsState.js';

import { Body, Field, Actions, ErrorBanner } from './_kit.js';

// Pod sign-in section (Bundle I, 2026-05-27).  Mirrors
// apps/tasks-mobile/src/screens/PodSettingsScreen.jsx: status row,
// issuer picker, sign-in / sign-out buttons.  Without provisioned
// creds (pending), startSignIn returns a "no issuer redirect"
// style error — UI surfaces it without crashing.
const KNOWN_ISSUERS = [
  { id: 'inrupt',         label: 'Inrupt Pod Spaces',  url: 'https://login.inrupt.com' },
  { id: 'solidcommunity', label: 'SolidCommunity.net', url: 'https://solidcommunity.net' },
  { id: 'solidweb',       label: 'SolidWeb.org',       url: 'https://solidweb.org' },
];

export default function SettingsWizardModal({
  visible, callSkill, onClose, t,
  // Bundle I (2026-05-27) — pod + relay surfaces on mobile.  When
  // these are absent (older callers), the corresponding section is
  // hidden so the modal degrades gracefully.
  podAuth,                       // { startSignIn, getCurrentSession, getRawSessionInfo, ... }
  agent,                         // { relay: { url, status, address, connect, disconnect }, vault }
  onSignOut,                     // () => Promise<void> — tears down podAuth session
}) {
  const [state, setState] = useState(() => initialState());
  const [handleInput, setHandleInput] = useState('');
  const [displayInput, setDisplayInput] = useState('');
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const next = { ...state };
      await loadSettings({ state: next, callSkill });
      if (active) {
        setState(next);
        setHandleInput(next.profile?.handle ?? '');
        setDisplayInput(next.profile?.displayName ?? '');
      }
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (msg) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2_500); };

  const onSaveHandle = useCallback(async () => {
    const r = await saveHandle({ callSkill, handle: handleInput });
    flash(r.ok ? '✓ Handle saved' : `✗ ${r.error}`);
  }, [callSkill, handleInput]);

  const onSaveDisplay = useCallback(async () => {
    const r = await saveDisplayName({ callSkill, displayName: displayInput });
    flash(r.ok ? '✓ Display name saved' : `✗ ${r.error}`);
  }, [callSkill, displayInput]);

  const onToggleHoliday = useCallback(async () => {
    const r = await setHolidayMode({ callSkill, on: !state.holiday });
    if (r.ok) setState((s) => ({ ...s, holiday: r.holidayMode }));
    flash(r.ok ? `✓ Holiday mode ${r.holidayMode ? 'on' : 'off'}` : `✗ ${r.error}`);
  }, [callSkill, state.holiday]);

  // ── Pod sign-in state + handlers ───────────────────────────────
  const [podSession, setPodSession] = useState(null);  // { webid } | null
  const [podBusy, setPodBusy]       = useState(false);
  const [podError, setPodError]     = useState(null);
  const [pickerIssuer, setPickerIssuer] = useState(KNOWN_ISSUERS[0].id);
  const [customIssuer, setCustomIssuer] = useState('');

  useEffect(() => {
    if (!visible || !podAuth?.getCurrentSession) return;
    try { setPodSession(podAuth.getCurrentSession() ?? null); }
    catch { setPodSession(null); }
  }, [visible, podAuth]);

  const onPodSignIn = useCallback(async () => {
    if (!podAuth?.startSignIn) return;
    setPodBusy(true);
    setPodError(null);
    try {
      const issuer = pickerIssuer === 'custom'
        ? customIssuer.trim()
        : KNOWN_ISSUERS.find((i) => i.id === pickerIssuer)?.url;
      if (!issuer) {
        setPodError('Please enter an issuer URL.');
      } else {
        const result = await podAuth.startSignIn({ issuer });
        if (result?.error) setPodError(String(result.error));
        else setPodSession(podAuth.getCurrentSession?.() ?? null);
      }
    } catch (err) {
      setPodError(err?.message ?? String(err));
    } finally {
      setPodBusy(false);
    }
  }, [podAuth, pickerIssuer, customIssuer]);

  const onPodSignOut = useCallback(async () => {
    if (podBusy) return;
    setPodBusy(true);
    setPodError(null);
    try {
      if (typeof onSignOut === 'function') await onSignOut();
      setPodSession(null);
    } catch (err) {
      setPodError(err?.message ?? String(err));
    } finally {
      setPodBusy(false);
    }
  }, [podBusy, onSignOut]);

  // ── NKN relay state + handlers ─────────────────────────────────
  // `agent.relay.url` is the currently-applied URL.  Showing it
  // first means a fresh modal already reflects state without an
  // extra round-trip.
  const [relayInput, setRelayInput] = useState('');
  const [relayBusy, setRelayBusy]   = useState(false);
  const [relayError, setRelayError] = useState(null);
  const currentRelay  = agent?.relay?.url ?? '';
  const currentStatus = agent?.relay?.status ?? 'unknown';

  useEffect(() => {
    if (!visible) return;
    setRelayInput(currentRelay);
    setRelayError(null);
  }, [visible, currentRelay]);

  const onSaveRelay = useCallback(async () => {
    const url = relayInput.trim();
    if (!agent?.relay) { setRelayError('Relay subsystem not available.'); return; }
    if (!/^wss?:\/\//.test(url)) {
      setRelayError('URL must start with ws:// or wss://');
      return;
    }
    setRelayBusy(true);
    setRelayError(null);
    try {
      try { await agent.vault?.set?.('relay/url', url); } catch { /* persistence is best-effort */ }
      if (agent.relay.status === 'connected') {
        try { await agent.relay.disconnect(); } catch { /* swallow */ }
      }
      await agent.relay.connect({ relayUrl: url });
      flash('✓ Relay applied');
    } catch (err) {
      setRelayError(err?.message ?? String(err));
    } finally {
      setRelayBusy(false);
    }
  }, [relayInput, agent]);

  const onClearRelay = useCallback(async () => {
    if (!agent?.relay) return;
    setRelayBusy(true);
    setRelayError(null);
    try {
      try { await agent.relay.disconnect(); } catch { /* swallow */ }
      try { await agent.vault?.delete?.('relay/url'); }
      catch { try { await agent.vault?.set?.('relay/url', ''); } catch { /* ignore */ } }
      setRelayInput('');
      flash('✓ Relay cleared');
    } catch (err) {
      setRelayError(err?.message ?? String(err));
    } finally {
      setRelayBusy(false);
    }
  }, [agent]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="settings-wizard"
        >
          <ScrollView style={styles.scroll}>
            <Body title="Settings" intro="Stoop profile + holiday mode.">
              {state.loading ? (
                <Text style={styles.loading}>Loading…</Text>
              ) : (
                <>
                  <View style={styles.section}>
                    <Field
                      label="Handle"
                      value={handleInput}
                      onChangeText={setHandleInput}
                      placeholder="e.g. alice"
                      monospace
                    />
                    <TouchableOpacity onPress={onSaveHandle} style={styles.saveBtn}>
                      <Text style={styles.saveBtnText}>{t('circle.wizard.settings.save_handle')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.section}>
                    <Field
                      label="Display name"
                      value={displayInput}
                      onChangeText={setDisplayInput}
                      placeholder={t('circle.wizard.settings.display_placeholder')}
                    />
                    <TouchableOpacity onPress={onSaveDisplay} style={styles.saveBtn}>
                      <Text style={styles.saveBtnText}>{t('circle.wizard.settings.save_display')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.section}>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{t('circle.wizard.settings.holiday')}</Text>
                      <TouchableOpacity
                        onPress={onToggleHoliday}
                        style={[styles.toggle, state.holiday && styles.toggleOn]}
                      >
                        <Text style={styles.toggleText}>
                          {state.holiday ? 'On' : 'Off'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.hint}>
                      Pauses outbound notifications while keeping the substrate alive.
                    </Text>
                  </View>
                  {feedback && (
                    <Text style={[styles.feedback,
                      feedback.startsWith('✓') ? styles.feedbackOk : styles.feedbackError]}>
                      {feedback}
                    </Text>
                  )}
                  <ErrorBanner message={state.loadError} />

                  {/* ── Pod sign-in section ─────────────────────────── */}
                  {podAuth ? (
                    <View style={styles.section} testID="settings-pod-section">
                      <Text style={styles.sectionHeader}>Solid pod</Text>
                      {podSession?.webid ? (
                        <>
                          <View style={styles.row}>
                            <Text style={styles.rowLabel}>WebID</Text>
                            <Text style={styles.rowValue} numberOfLines={2} selectable>
                              {podSession.webid}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={onPodSignOut}
                            disabled={podBusy}
                            style={[styles.saveBtn, styles.saveBtnSecondary, podBusy && styles.btnDisabled]}
                            accessibilityLabel="settings-pod-signout"
                          >
                            <Text style={[styles.saveBtnText, styles.saveBtnTextSecondary]}>
                              {podBusy ? 'Signing out…' : 'Sign out'}
                            </Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <Text style={styles.hint}>
                            Sign in to a Solid pod so your data syncs across devices.
                            Real OIDC on mobile is still in development — without provisioned
                            credentials the system browser will return an error.
                          </Text>
                          <Text style={styles.rowLabel}>Issuer</Text>
                          {KNOWN_ISSUERS.map((iss) => (
                            <TouchableOpacity
                              key={iss.id}
                              onPress={() => setPickerIssuer(iss.id)}
                              style={styles.radioRow}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: pickerIssuer === iss.id }}
                            >
                              <View style={[styles.radio, pickerIssuer === iss.id && styles.radioOn]} />
                              <Text style={styles.radioLabel}>{iss.label}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity
                            onPress={() => setPickerIssuer('custom')}
                            style={styles.radioRow}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: pickerIssuer === 'custom' }}
                          >
                            <View style={[styles.radio, pickerIssuer === 'custom' && styles.radioOn]} />
                            <Text style={styles.radioLabel}>{t('circle.wizard.settings.other_url')}</Text>
                          </TouchableOpacity>
                          {pickerIssuer === 'custom' && (
                            <Field
                              label=""
                              value={customIssuer}
                              onChangeText={setCustomIssuer}
                              placeholder="https://login.example.org"
                              monospace
                            />
                          )}
                          <TouchableOpacity
                            onPress={onPodSignIn}
                            disabled={podBusy}
                            style={[styles.saveBtn, podBusy && styles.btnDisabled]}
                            accessibilityLabel="settings-pod-signin"
                          >
                            <Text style={styles.saveBtnText}>
                              {podBusy ? 'Opening browser…' : 'Sign in to pod'}
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                      {podError && <Text style={styles.feedbackError}>{podError}</Text>}
                    </View>
                  ) : null}

                  {/* ── NKN relay section ───────────────────────────── */}
                  {agent?.relay ? (
                    <View style={styles.section} testID="settings-relay-section">
                      <Text style={styles.sectionHeader}>NKN relay</Text>
                      <View style={styles.row}>
                        <Text style={styles.rowLabel}>Status</Text>
                        <Text style={styles.rowValue}>{currentStatus}</Text>
                      </View>
                      {currentRelay ? (
                        <View style={styles.row}>
                          <Text style={styles.rowLabel}>Current</Text>
                          <Text style={styles.rowValue} numberOfLines={1} selectable>
                            {currentRelay}
                          </Text>
                        </View>
                      ) : null}
                      <Field
                        label="Relay URL"
                        value={relayInput}
                        onChangeText={setRelayInput}
                        placeholder="wss://relay.example.org"
                        monospace
                      />
                      <View style={styles.btnRow}>
                        <TouchableOpacity
                          onPress={onSaveRelay}
                          disabled={relayBusy}
                          style={[styles.saveBtn, relayBusy && styles.btnDisabled]}
                          accessibilityLabel="settings-relay-save"
                        >
                          <Text style={styles.saveBtnText}>
                            {relayBusy ? 'Connecting…' : 'Apply'}
                          </Text>
                        </TouchableOpacity>
                        {currentRelay ? (
                          <TouchableOpacity
                            onPress={onClearRelay}
                            disabled={relayBusy}
                            style={[styles.saveBtn, styles.saveBtnSecondary, relayBusy && styles.btnDisabled]}
                            accessibilityLabel="settings-relay-clear"
                          >
                            <Text style={[styles.saveBtnText, styles.saveBtnTextSecondary]}>
                              Clear
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <Text style={styles.hint}>
                        Override the auto-selected NKN relay (advanced).  ws:// or wss:// only.
                      </Text>
                      {relayError && <Text style={styles.feedbackError}>{relayError}</Text>}
                    </View>
                  ) : null}
                </>
              )}
            </Body>
          </ScrollView>
          <Actions buttons={[{ label: t('common.done'), onPress: onClose, kind: 'primary' }]} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '88%', minHeight: '60%',
  },
  scroll: { flexGrow: 1 },
  loading: { fontSize: 13, color: '#666', fontStyle: 'italic' },
  section: { gap: 6, marginTop: 12 },
  saveBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e88e5', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14, marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 14, color: '#222', fontWeight: '600' },
  toggle: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#ddd',
  },
  toggleOn: { backgroundColor: '#43a047' },
  toggleText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 11, color: '#666', marginTop: 2 },
  feedback: { fontSize: 13, marginTop: 12 },
  feedbackOk: { color: '#1b5e20' },
  feedbackError: { color: '#b00', fontSize: 12, marginTop: 6 },
  // Bundle I additions — pod + relay sections.
  sectionHeader: {
    fontSize: 11, fontWeight: '700', color: '#666',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: 16, marginBottom: 4,
  },
  rowValue:           { fontSize: 13, color: '#222', flex: 1, marginLeft: 12 },
  saveBtnSecondary:   { backgroundColor: '#eee', marginLeft: 8 },
  saveBtnTextSecondary: { color: '#222' },
  btnDisabled:        { opacity: 0.5 },
  btnRow:             { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  hint:               { fontSize: 11, color: '#666', marginTop: 4, lineHeight: 16 },
  radioRow:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  radio:              { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#999', marginRight: 8 },
  radioOn:            { borderColor: '#1e88e5', backgroundColor: '#1e88e5' },
  radioLabel:         { fontSize: 13, color: '#222' },
});
