/**
 * SignInScreen — entry point when no OIDC session is restored.
 *
 * Shows a "Sign in with Solid" button that drives the
 * `expo-auth-session` flow against Inrupt's hosted IdP.  After token
 * exchange, the user is asked for their pod root URL (defaults to a
 * sensible guess derived from the WebID when available).  Both pieces
 * are handed to ServiceContext.adoptTokens which boots the engine.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { useFolioAuth }            from '../auth/folioAuthHook.js';
import { DEFAULT_INRUPT_ISSUER }   from '../auth/folioAuth.js';
import { IssuerPicker }            from '@onderling/oidc-session-rn/picker';
import { useService } from '../ServiceContext.js';
import { suggestPodRoot, normalizePodRoot, discoverPodRoot } from '../lib/podRootHelpers.js';

export { suggestPodRoot, normalizePodRoot };

/**
 * @param {object} [props]
 * @param {string} [props.issuer]   Override the Inrupt issuer (tests / staging).
 */
/**
 * Default folder name inside the pod for Folio's notes.  Kept as a
 * named constant so the SignInScreen + tests share the value.
 */
export const DEFAULT_POD_FOLDER = 'notes';

/**
 * Origin-only fallback when WebID-profile discovery fails — extracts
 * `<scheme>://<host>/` from a WebID URL.  Used before / instead of
 * `discoverPodRoot()` so the form is never empty during the brief
 * window between sign-in and discovery completing.
 *
 * @param {string} webid
 * @returns {string}
 */
function deriveBaseFromWebId(webid) {
  if (typeof webid !== 'string' || webid.length === 0) return '';
  try {
    return `${new URL(webid).origin}/`;
  } catch { return ''; }
}

/**
 * Combine a pod base URL and a folder name into a normalised pod-root.
 * Trims duplicate slashes.  Folder may be empty (root-of-pod) or a
 * deep path like `notes/work`.
 *
 * @param {string} base
 * @param {string} folder
 * @returns {string}
 */
function combinePodRoot(base, folder) {
  const cleanBase   = String(base   ?? '').trim().replace(/\/+$/, '');
  const cleanFolder = String(folder ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (cleanBase.length === 0) return '';
  return cleanFolder.length === 0 ? cleanBase + '/' : `${cleanBase}/${cleanFolder}/`;
}

export function SignInScreen({ issuer: initialIssuer = DEFAULT_INRUPT_ISSUER } = {}) {
  const { adoptTokens, status } = useService();
  const [stage, setStage]       = useState('idle');     // idle | signing-in | got-tokens | configuring
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [pendingTokens, setPendingTokens] = useState(null);
  const [podBaseInput, setPodBaseInput]   = useState('');
  const [podFolderInput, setPodFolderInput] = useState(DEFAULT_POD_FOLDER);
  // Phase 52.15.5 (2026-05-14) — issuer is now user-selectable.
  const [issuer, setIssuer]     = useState(initialIssuer);

  const { ready, signIn, resetClient, lastError } = useFolioAuth({ issuer });

  const onSignInPress = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await signIn();
      setPendingTokens(tokens);
      // Pre-fill the BASE input (the "id/key thingy" — pod storage host
      // + UUID).  Folder defaults to `notes`.  Two-step:
      //   1. instant origin-only fallback so the field is never blank,
      //   2. async WebID-profile discovery to replace with the real
      //      pim:storage URL (Inrupt separates id.* from storage.*).
      if (tokens.webid) {
        setPodBaseInput(deriveBaseFromWebId(tokens.webid));
        discoverPodRoot(tokens.webid, { accessToken: tokens.accessToken })
          .then((real) => { if (real) setPodBaseInput(real); })
          .catch(() => { /* keep fallback */ });
      }
      setStage('got-tokens');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [ready, busy, signIn]);

  const onContinuePress = useCallback(async () => {
    if (busy) return;
    if (!pendingTokens) return;
    const combined = combinePodRoot(podBaseInput, podFolderInput);
    if (combined.length === 0) {
      setError(new Error('Pod base URL is required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adoptTokens(pendingTokens, { podRoot: normalizePodRoot(combined) });
      setStage('configuring');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, pendingTokens, podBaseInput, podFolderInput, adoptTokens]);

  return (
    <KeyboardAvoidingView style={s.root} behaviour={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Folio</Text>
        <Text style={s.h2}>Your markdown notes, mirrored into your Solid pod.</Text>

        {stage !== 'got-tokens' && (
          <View style={s.section}>
            <IssuerPicker value={issuer} onChange={setIssuer} />
            <View style={{ height: 16 }} />
            <Pressable
              onPress={onSignInPress}
              disabled={!ready || busy}
              style={({ pressed }) => [
                s.primaryBtn,
                (!ready || busy) && { opacity: 0.6 },
                pressed && { opacity: 0.8 },
              ]}
            >
              {busy
                ? <ActivityIndicator color="#0f1117" />
                : <Text style={s.primaryBtnLabel}>Sign in with Solid</Text>}
            </Pressable>
            <Text style={s.hint}>
              You will be sent to {issuer} in a secure browser window.
            </Text>
          </View>
        )}

        {stage === 'got-tokens' && (
          <View style={s.section}>
            <Text style={s.label}>Pod base URL</Text>
            <TextInput
              value={podBaseInput}
              onChangeText={setPodBaseInput}
              placeholder="https://storage.inrupt.com/<uuid>/"
              placeholderTextColor="#5c6377"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={s.input}
            />
            <Text style={s.hintSmall}>
              Auto-detected from your WebID profile.  Edit only if your
              storage server lives somewhere other than the auto-detected URL.
            </Text>

            <View style={{ height: 16 }} />

            <Text style={s.label}>Folder</Text>
            <TextInput
              value={podFolderInput}
              onChangeText={setPodFolderInput}
              placeholder="notes"
              placeholderTextColor="#5c6377"
              autoCapitalize="none"
              autoCorrect={false}
              style={s.input}
            />
            <Text style={s.hintSmall}>
              The container in your pod where Folio will read + write notes.
              Default: <Text style={s.hintInline}>notes</Text>.
              {'\n'}Combined: <Text style={s.hintInline}>{combinePodRoot(podBaseInput, podFolderInput) || '—'}</Text>
            </Text>
            <Pressable
              onPress={onContinuePress}
              disabled={busy || podBaseInput.length === 0}
              style={({ pressed }) => [
                s.primaryBtn,
                (busy || podBaseInput.length === 0) && { opacity: 0.6 },
                pressed && { opacity: 0.8 },
              ]}
            >
              {busy
                ? <ActivityIndicator color="#0f1117" />
                : <Text style={s.primaryBtnLabel}>Continue</Text>}
            </Pressable>
          </View>
        )}

        {(error || lastError) && (
          <View style={s.errorBox}>
            <TextInput
              style={s.errorInput}
              multiline
              scrollEnabled
              selectTextOnFocus
              autoCorrect={false}
              autoCapitalize="none"
              value={
                `${error ? '[onPress] ' : '[hook] '}` +
                `${error?.message ?? lastError?.message ?? String(error ?? lastError)}\n` +
                `${String(error?.stack ?? lastError?.stack ?? '').split('\n').slice(0, 12).join('\n')}`
              }
              onChangeText={() => {}}
            />
            {/*
             * Recovery affordance for stale-cached-client_id issues.
             * Symptom: Sign In opens browser, Inrupt shows "Invalid
             * client_id", you close it, the app reports AUTH_DISMISSED.
             * Tap this button to clear the cached client_id; DCR
             * re-registers fresh on the next Sign In.
             */}
            <Pressable
              style={s.resetBtn}
              onPress={async () => {
                setError(null);
                if (typeof resetClient === 'function') await resetClient();
              }}
            >
              <Text style={s.resetBtnLabel}>Reset auth & retry</Text>
            </Pressable>
          </View>
        )}

        <View style={s.statusBox}>
          <Text style={s.statusLabel}>State: <Text style={s.statusValue}>{status}</Text></Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#0f1117' },
  scroll:         { padding: 24, paddingTop: 80 },
  h1:             { color: '#d4d8f0', fontSize: 32, fontWeight: '700', marginBottom: 8 },
  h2:             { color: '#8c93b8', fontSize: 14, lineHeight: 20, marginBottom: 32 },
  section:        { marginBottom: 24 },
  label:          { color: '#9aa0c4', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input:          {
    backgroundColor: '#1a1d27',
    color:           '#d4d8f0',
    fontSize:        15,
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       '#2a2f3f',
    fontFamily:        Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hint:           { color: '#6b7094', fontSize: 12, marginTop: 16, lineHeight: 18 },
  hintSmall:      { color: '#6b7094', fontSize: 11, marginTop: 8, marginBottom: 16, lineHeight: 16 },
  hintInline:     { color: '#9aa0c4', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  primaryBtn:     {
    backgroundColor: '#9bcfff',
    paddingVertical: 14,
    borderRadius:    8,
    alignItems:      'center',
    marginTop:       8,
  },
  primaryBtnLabel:{ color: '#0f1117', fontSize: 16, fontWeight: '700' },
  errorBox:       { backgroundColor: '#3a1f23', padding: 12, borderRadius: 6, marginBottom: 12 },
  errorText:      { color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
  errorInput:     {
    color:           '#f0a8a8',
    fontSize:        11,
    fontFamily:      Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: 'transparent',
    padding:         0,
    margin:          0,
    minHeight:       120,
    textAlignVertical: 'top',
  },
  resetBtn:       {
    marginTop:       10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius:    6,
    backgroundColor: '#5a3035',
    alignSelf:       'flex-start',
  },
  resetBtnLabel:  { color: '#f0a8a8', fontSize: 12, fontWeight: '600' },
  statusBox:      { marginTop: 24, alignItems: 'center' },
  statusLabel:    { color: '#5c6377', fontSize: 12 },
  statusValue:    { color: '#9aa0c4', fontFamily: 'monospace' },
});
