/**
 * basis-mobile v2 — "My data" screen (RN, S5 parity).
 *
 * RN mirror of web's circleMyData: where your data lives (getDataLocation +
 * podSignInStatus), the getPrivacyNotice disclosure, a getMetrics usage snapshot,
 * and the S5 key-management actions (back up · reveal recovery phrase · restore).
 * Self-contained: loads + mutates via the injected stoop-capable `callSkill`.
 * The backup/restore flows reuse the existing RN wizard modals — no reimpl.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal, TextInput, Alert, Share } from 'react-native';
import { t, lang, setLang } from '../../core/localisation.js';
import { useTheme, useThemePref } from './themeContext.js';
import { surfacePrefStore } from '../../core/surfacePrefStore.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createRelayPrefStore, asyncStorageRelayIo } from '../../../../basis/src/v2/relayPref.js';
// The two delivery settings — one store, because they are two knobs on the same question (how much does
// the network learn in exchange for the message arriving). web≡mobile via deliverySettings.js.
import {
  createDeliverySettingsStore, asyncStorageDeliveryIo,
} from '../../../../basis/src/v2/deliverySettings.js';
// P1 §4 tail — how long this device keeps conversations. ONE control (the chat window); plumbing
// follows it and the audit trail uses it as a DETAIL window, compacting past it. web≡mobile.
import {
  RETENTION_CHOICES_DAYS, normalizeRetentionDays, daysToMs,
} from '../../../../basis/src/v2/retentionPref.js';
// "Never share my global address" (J-CS8) — the strictest privacy position in the product: one address
// across everything is what links a person's circles together.
import { SHARE_NKN_ADDRESS_PARAM_KEY } from '../../../../basis/src/v2/addressSharing.js';
// CONNECTIONS — the same shared projections the web shell paints from, so the two shells cannot
// drift on what a connection may see or do (invariant 2: web ≡ mobile by construction).
import {
  connectionRows, connectionOpChoices, connectionSectionChoices, compileConnectionGrant,
} from '../../../../basis/src/v2/connections.js';
import { parsePairingOffer } from '../../../../basis/src/v2/connectionPairing.js';
import { CONNECTION_MANIFESTS } from '../../../../basis/src/v2/connectionManifests.js';
import { loadCircles } from '../../../../basis/src/v2/circleModel.js';
import { circleSourcesFromAgent } from '../../../../basis/src/v2/circleSources.js';
import UserLlmSettings from './UserLlmSettings.js';
import EncryptedBackupWizardModal from '../../../../basis/src/rn/wizards/encryptedBackupWizardModal.js';
import RestoreFromMnemonicWizardModal from '../../../../basis/src/rn/wizards/restoreFromMnemonicWizardModal.js';
import EnrollDeviceModal from './EnrollDeviceModal.js';
import RevokeDeviceModal from './RevokeDeviceModal.js';
import { deviceDelegationsOf } from '@onderling/agent-registry';
import { enableNativePush, disableNativePush, getNativePushState } from '../../v2/nativePush.js';

const CHAT_AI_KEY = { on: 'chat_ai_on', 'circle-off': 'chat_ai_circle_off', 'no-llm': 'chat_ai_no_llm', 'no-provider': 'chat_ai_no_provider' };

export default function CircleMyDataScreen({ callSkill, onBack, chatAi, userLlm, onSaveUserLlm, validateUserLlm, onReconnectPeer, agent = null,
  onOpenConnectionPoints, eventLog = null }) {
  // Reactive theme — reading it at render time is what lets the display-theme
  // toggle below recolour THIS screen live (module-level StyleSheets can't).
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [themePref, setThemePref] = useThemePref();
  // Section / KV close over the render-time `styles` so they recolour with the theme.
  const Section = useCallback(({ title, children }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  ), [styles]);
  const KV = useCallback(({ k, v }) => (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  ), [styles]);
  const [dataLocation, setDataLocation] = useState({});
  // Re-read tick for the history-mirror row (the flip is live on the agent; the row re-reads it).
  const [, setHistoryTick] = useState(0);
  const [podStatus, setPodStatus] = useState({});
  // The pod session as the `whoami` op reports it — `ok:false` means this build has no pod session
  // capability at all, which is what used to be read off the presence of a `podAuth` prop.
  const [session, setSession] = useState(null);
  // cluster J — pod sign-in entry (the v2 UI had none; sign-in was stranded in the hidden ChatScreen).
  const [issuer, setIssuer] = useState('https://login.inrupt.com');
  const [signingIn, setSigningIn] = useState(false);
  const [signInErr, setSignInErr] = useState('');
  const [privacy, setPrivacy] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [wizard, setWizard] = useState(null);          // 'backup' | 'restore' | 'enroll' | null
  const [devices, setDevices] = useState([]);          // enrolled-device rows (registry delegations)
  const [connections, setConnections] = useState([]);  // paired views ("gekoppelde apparaten")
  const [offerText, setOfferText] = useState('');      // the pasted onderling-connect:// code
  const [pickedOps, setPickedOps] = useState([]);      // what the new connection may DO
  const [pickedSections, setPickedSections] = useState([]); // what it may SEE
  const [circlesForConnections, setCirclesForConnections] = useState([]);
  // The SHARED list, not this shell's dispatch catalogue. Reusing the catalogue here made the mobile menu a
  // different set from web's — including stoop, whose manifest declares 92 ops — so the same person
  // pairing the same screen was offered materially different authority depending on which shell they
  // happened to use. Both shells and the A2A surface now read one list (invariant 2, by construction).
  const manifestsForConnections = CONNECTION_MANIFESTS;
  const [revokeTarget, setRevokeTarget] = useState(null);   // deviceId under the revoke ceremony
  const [mnemonic, setMnemonic] = useState(null);      // { words } | null when closed
  const [push, setPush] = useState({ supported: false, granted: false });   // S6.6 native push
  const [surfacePref, setSurfacePref] = useState(surfacePrefStore.get());    // S6.C surface preference
  const setPref = useCallback((v) => { surfacePrefStore.set(v).then(() => setSurfacePref(v)).catch(() => {}); }, []);

  // In-app relay setting — point the no-server cross-device relay at a reachable server WITHOUT a rebuild
  // (web≡mobile via relayPref.js). agentBundle/hostOps read this at connect; applies on the next app open.
  const relayStore = React.useMemo(() => createRelayPrefStore(asyncStorageRelayIo(AsyncStorage)), []);
  const [relayInput, setRelayInput] = useState('');
  const [relayNote, setRelayNote] = useState('');
  useEffect(() => { relayStore.get().then(setRelayInput).catch(() => {}); }, [relayStore]);
  const saveRelay = useCallback(async () => {
    try {
      const saved = await relayStore.set(relayInput);
      setRelayInput(saved);
      // Live reconnect when the host wired it (bundle.reconnectPeer); otherwise it applies on next app open.
      if (typeof onReconnectPeer === 'function') {
        setRelayNote(t('circle.mydata.relay_saving'));
        const r = await onReconnectPeer();
        setRelayNote(r && r.ok
          ? t('circle.mydata.relay_saved', { url: r.effective || t('circle.mydata.relay_off') })
          : t('circle.mydata.relay_error', { msg: (r && r.error) || '' }));
      } else {
        setRelayNote(t('circle.mydata.relay_saved_reload', { url: saved || t('circle.mydata.relay_off') }));
      }
    } catch (e) { setRelayNote(t('circle.mydata.relay_error', { msg: e?.message ?? '' })); }
  }, [relayStore, relayInput, onReconnectPeer]);

  // The connection-point LIST (Nearby step I) — the relay field above sets one url; this shows every point
  // the device knows, which circles ride each, and what removing one would cost.
  const openPoints = useCallback(() => { onOpenConnectionPoints?.(); }, [onOpenConnectionPoints]);

  const deliveryStore = React.useMemo(
    () => createDeliverySettingsStore(asyncStorageDeliveryIo(AsyncStorage)), [],
  );
  const [delivery, setDelivery] = useState({ sendReceipts: true, allowFallback: false });
  useEffect(() => { deliveryStore.get().then(setDelivery).catch(() => {}); }, [deliveryStore]);
  const toggleDelivery = useCallback(async (patch) => {
    try { setDelivery(await deliveryStore.set(patch)); } catch { /* keep the old view */ }
  }, [deliveryStore]);

  // P1 §4 tail — the retention choice, applied LIVE (setRetention prunes at once) so a shortened
  // window shows immediately rather than after a restart.
  // The address-sharing setting lives in the parameter register since the consolidation — the
  // read is the live enforced value, the write goes through the one kind-gated set-param.
  const shareNknAddress = agent ? agent.getParamValue?.(SHARE_NKN_ADDRESS_PARAM_KEY) !== false : null;
  const toggleShareAddress = useCallback(async () => {
    const next = !(shareNknAddress !== false);
    try { await callSkill('params', 'set-param', { key: SHARE_NKN_ADDRESS_PARAM_KEY, value: next }); } catch { /* the row re-reads */ }
    setHistoryTick((n) => n + 1);
  }, [callSkill, shareNknAddress]);

  // Message cleanup (web parity) — the conversation is the RECORD and never expires by policy; deleting
  // old messages is the user's own explicit act, confirmed through the platform dialog. The result line
  // reports the real count from the log itself.
  const [cleanupDays, setCleanupDays] = useState(RETENTION_CHOICES_DAYS[RETENTION_CHOICES_DAYS.length - 1]);
  const [cleanupResult, setCleanupResult] = useState(null);
  const runCleanup = useCallback(() => {
    const days = normalizeRetentionDays(cleanupDays);
    Alert.alert(
      t('circle.mydata.cleanup_button', { days }),
      t('circle.mydata.cleanup_confirm'),
      [
        { text: t('circle.confirm.cancel'), style: 'cancel' },
        {
          text: t('circle.mydata.cleanup'),
          style: 'destructive',
          onPress: () => {
            let count = 0;
            try { count = eventLog?.purgeConversation?.({ olderThanMs: daysToMs(days) }) ?? 0; } catch { count = 0; }
            setCleanupResult(count);
          },
        },
      ],
    );
  }, [cleanupDays, eventLog, t]);

  useEffect(() => { getNativePushState().then(setPush).catch(() => {}); }, []);
  const toggleNativePush = useCallback(async () => {
    if (push.granted) await disableNativePush({ callSkill });
    else await enableNativePush({ callSkill });
    setPush(await getNativePushState());
  }, [push.granted, callSkill]);

  const revealMnemonic = useCallback(async () => {
    // The OWNER-ROOT phrase (host `revealOwnerPhrase`, step 1b) — re-derives every
    // profile incl. the feedback pseudonym. Was stoop `getMnemonicOnce` (wrong seed).
    let words = '';
    try {
      const res = await callSkill('household', 'revealOwnerPhrase', {});
      if (res && !res.error) words = res.mnemonic ?? res.phrase ?? res.words ?? '';
    } catch { words = ''; }
    setMnemonic({ words: Array.isArray(words) ? words.join(' ') : String(words || '') });
  }, [callSkill]);

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    const [loc, status, priv, met, profProps, session] = await Promise.all([
      callSkill('stoop', 'getDataLocation', {}).catch(() => null),
      callSkill('stoop', 'podSignInStatus', {}).catch(() => null),
      callSkill('stoop', 'getPrivacyNotice', { lang: lang() }).catch(() => null),
      callSkill('stoop', 'getMetrics', {}).catch(() => null),
      callSkill('agents', 'getProfileProperties', { id: 'default' }).catch(() => null),
      // The live pod session, through the waist. `whoami` reports it from the same podAuth this screen
      // used to read directly — one implementation, and the op is the only thing that knows the
      // substrate. It survives access-token expiry the way the raw read did, because the op falls back
      // to the raw session info itself.
      callSkill('basis', 'whoami', {}).catch(() => null),
    ]);
    setSession(session ?? null);
    setDataLocation(loc ?? {});
    setPodStatus(status ?? {});
    setPrivacy(Array.isArray(priv?.sections) ? priv.sections : []);
    setMetrics((met?.snapshot && typeof met.snapshot === 'object') ? met.snapshot : {});
    // The enrolled-devices list (add-a-device bookkeeping) — one row per registry delegation.
    setDevices(Object.values(deviceDelegationsOf({ properties: profProps?.properties ?? {} }))
      .map((d) => ({ deviceId: d.deviceId, label: d.label ?? null, revoked: d.revoked === true })));
    // The paired views. A read, never an authority: the grants live in the agent's durable
    // registry and the acting door reads THAT, so a stale list can only look stale.
    const conns = await callSkill('household', 'listSurfaceGrants', {}).catch(() => null);
    setConnections(Array.isArray(conns?.surfaces) ? conns.surfaces : []);
    // The circles a connection can be granted sight of — through the SAME loader the launcher
    // uses, not a hand-rolled skill call. (`stoop.listGroups` looks like the op for this and is
    // not one: the only listGroups is a core GroupManager method, so calling it would have left
    // this list silently empty forever — the exact `screens/**` trap the gotchas file names.)
    try {
      const cs = await loadCircles(circleSourcesFromAgent({ callSkill }));
      setCirclesForConnections((Array.isArray(cs) ? cs : [])
        .map((c) => ({ id: c.id, name: c.name ?? c.label ?? c.id })).filter((c) => c.id));
    } catch { /* leave the previous list rather than blanking it on a transient */ }
  }, [callSkill]);

  useEffect(() => { load(); }, [load]);

  // Both acts go through the waist: the op owns podAuth, the screen owns the button. `signin` reports a
  // refusal as `{ok:false,error}` rather than throwing, so raise it as an error here and the retry below
  // keeps working on the message the way it always did.
  const runSignIn = useCallback(async () => {
    const r = await callSkill('basis', 'signin', issuer.trim() ? { issuer: issuer.trim() } : {});
    if (r && r.ok === false) throw new Error(r.error ?? 'sign-in failed');
    return r;
  }, [callSkill, issuer]);

  const doSignIn = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    setSignInErr(''); setSigningIn(true);
    try { await runSignIn(); }
    catch (e) {
      // DCR/discovery race: the client_id (re)registers async on mount + after a stale-client purge; a tap
      // during that window throws CLIENT_ID_PENDING/DISCOVERY_PENDING ("registration not yet complete").
      // Wait briefly + retry once instead of surfacing the transient error.
      const msg = e?.message ?? String(e);
      if (['CLIENT_ID_PENDING', 'DISCOVERY_PENDING', 'REQUEST_PENDING'].includes(e?.code) || /not yet complete/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1500));
        try { await runSignIn(); }
        catch (e2) { setSignInErr(e2?.message ?? String(e2)); }
      } else { setSignInErr(msg); }
    }
    finally { setSigningIn(false); }
    load().catch(() => {});   // refresh pod status separately — its failure must not look like a sign-in error
  }, [callSkill, runSignIn, load]);
  const doSignOut = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    try { await callSkill('basis', 'signout', {}); await load(); } catch { /* best-effort */ }
  }, [callSkill, load]);

  // Status from the actual session, not just the stoop skill: `whoami` reports a webid whenever a session
  // whenever a session exists — including after the short access token expires (still refreshable) — so the
  // "Me" screen doesn't lag back to "Local only" the way isAuthenticated()-based podSignInStatus does.
  const podCapable = session?.ok !== false;
  const podSignedIn = podStatus.signedIn || !!session?.webid;
  const podWebid = podStatus.webid || session?.webid || '';
  const relay = [dataLocation.relayOperator, dataLocation.relayUrl].filter(Boolean).join(' · ');
  const usage = Object.entries(metrics || {});

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="circle-mydata">
      <View style={styles.header}>
        {typeof onBack === 'function' && <Pressable onPress={onBack} testID="mydata-back"><Text style={styles.back}>{t('circle.mydata.back')}</Text></Pressable>}
        <Text style={styles.title}>{t('circle.mydata.title')}</Text>
      </View>

      <Section title={t('circle.mydata.storage')}>
        <KV k={t('circle.mydata.pod')} v={podSignedIn ? t('circle.mydata.pod_signed_in', { webid: podWebid }) : t('circle.mydata.pod_local')} />
        {/* What "local only" costs, said where the state is shown — web ≡ mobile (circleMyData.js). */}
        {!podSignedIn && (
          <Text style={styles.relayHint} testID="pod-local-consequence">
            {t('circle.mydata.pod_local_consequence')}
          </Text>
        )}
        {dataLocation.podRoot ? <KV k={t('circle.mydata.pod_root')} v={dataLocation.podRoot} /> : null}
        {relay ? <KV k={t('circle.mydata.relay')} v={relay} /> : null}

        {/* In-app relay setting — no-server cross-device sync, configurable without a rebuild. */}
        <View style={styles.relayEdit}>
          <TextInput
            style={styles.relayInput}
            value={relayInput}
            onChangeText={setRelayInput}
            placeholder={process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL || 'ws://…:8787'}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="relay-input"
          />
          <Pressable style={styles.relaySave} onPress={saveRelay} testID="relay-save">
            <Text style={styles.relaySaveText}>{t('circle.mydata.relay_save')}</Text>
          </Pressable>
        </View>
        {relayNote ? <Text style={styles.relayNote}>{relayNote}</Text> : null}
        <Text style={styles.relayHint}>{t('circle.mydata.relay_hint')}</Text>
        {/* The LIST behind the single field above — which points this device knows, what rides each, and
            what removing one would cost (Nearby step I). */}
        <Pressable style={styles.relaySave} onPress={openPoints} testID="open-connection-points">
          <Text style={styles.relaySaveText}>{t('circle.nearbyScreen.points_open')}</Text>
        </Pressable>

        {/* Delivery (2026-07-28). Both lines say what HAPPENS, not which switch is where — and nothing
            tells you what others see about your receipt setting, because nothing in the model reveals it.
            A "they cannot tell" reassurance here would be the first place that leaked. */}
        <Text style={styles.sectionTitle}>{t('circle.nearbyScreen.delivery_section')}</Text>
        <Text style={styles.relayHint} testID="delivery-receipts-state">
          {t(delivery.sendReceipts
            ? 'circle.nearbyScreen.delivery_receipts_on'
            : 'circle.nearbyScreen.delivery_receipts_off')}
        </Text>
        <Pressable
          style={styles.relaySave}
          onPress={() => toggleDelivery({ sendReceipts: !delivery.sendReceipts })}
          testID="delivery-receipts-toggle"
        >
          <Text style={styles.relaySaveText}>
            {t(delivery.sendReceipts
              ? 'circle.nearbyScreen.delivery_receipts_toggle_on'
              : 'circle.nearbyScreen.delivery_receipts_toggle_off')}
          </Text>
        </Pressable>

        <Text style={styles.relayHint} testID="delivery-fallback-state">
          {t(delivery.allowFallback
            ? 'circle.nearbyScreen.delivery_fallback_on'
            : 'circle.nearbyScreen.delivery_fallback_off')}
        </Text>
        {/* The cost rides WITH the option to enable it — never the fix alone. */}
        <Text style={styles.relayHint}>{t('circle.nearbyScreen.delivery_fallback_cost')}</Text>
        {/* The toggle is GONE until the stored setting reaches the send path (2026-08-02) — it wrote a
            preference nothing read, so both states behaved identically. A control that changes nothing is a
            stronger false claim than the sentence above it. web ≡ mobile: circleMyData.js does the same. */}
        <Text style={styles.relayHint} testID="delivery-fallback-note">
          {t('circle.nearbyScreen.delivery_fallback_note')}
        </Text>

        {/* cluster J — pod sign-in entry (the v2 UI had none). When signed out: pod provider + Connect. */}
        {podCapable && !podSignedIn && (
          <View style={styles.signin}>
            <TextInput
              style={styles.signinInput}
              value={issuer}
              onChangeText={setIssuer}
              placeholder={t('circle.mydata.pod_issuer')}
              placeholderTextColor={theme.color.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              testID="mydata-pod-issuer"
            />
            <Pressable style={[styles.action, signingIn && styles.actionMuted]} onPress={doSignIn} disabled={signingIn} testID="mydata-pod-signin">
              <Text style={styles.actionLabel}>{signingIn ? t('circle.mydata.pod_connecting') : t('circle.mydata.pod_sign_in')}</Text>
            </Pressable>
            {signInErr ? <Text style={styles.signinErr}>{signInErr}</Text> : null}
          </View>
        )}
        {podCapable && podSignedIn && (
          <Pressable style={[styles.action, styles.actionMuted]} onPress={doSignOut} testID="mydata-pod-signout">
            <Text style={styles.actionMutedLabel}>{t('circle.mydata.pod_signout')}</Text>
          </Pressable>
        )}
      </Section>

      <Section title={t('circle.mydata.keys')}>
        <Pressable style={styles.action} onPress={() => setWizard('backup')} testID="mydata-backup">
          <Text style={styles.actionLabel}>{t('circle.mydata.backup')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={revealMnemonic} testID="mydata-mnemonic">
          <Text style={styles.actionLabel}>{t('circle.mydata.view_mnemonic')}</Text>
        </Pressable>
        <Pressable style={[styles.action, styles.actionMuted]} onPress={() => setWizard('restore')} testID="mydata-restore">
          <Text style={styles.actionMutedLabel}>{t('circle.mydata.restore')}</Text>
        </Pressable>
        {/* Add-a-device: run the enroll ceremony ON THIS device (the phrase is typed here). */}
        <Pressable style={[styles.action, styles.actionMuted]} onPress={() => setWizard('enroll')} testID="mydata-enroll">
          <Text style={styles.actionMutedLabel}>{t('circle.mydata.enroll_device')}</Text>
        </Pressable>
      </Section>

      {/* Enrolled devices (add-a-device): one row per registry delegation; tombstones struck,
          no door. The revoke button opens the phrase-proven ceremony for that device. */}
      {devices.length > 0 && (
        <Section title={t('circle.mydata.devices')}>
          {devices.map((d) => (
            <View key={d.deviceId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
              <Text style={[styles.privacyBody, d.revoked && { textDecorationLine: 'line-through' }]}>
                {d.label || d.deviceId}
              </Text>
              {!d.revoked && (
                <Pressable onPress={() => setRevokeTarget(d.deviceId)} testID={`mydata-revoke-${d.deviceId}`}>
                  <Text style={styles.actionMutedLabel}>{t('circle.revoke.title')}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </Section>
      )}

      {/* CONNECTIONS — screens that are yours, somewhere else. Beside the devices list because it
          answers the same question ("what else of mine is out there"); the two differ in what they
          can DO — a device holds your keys, a connection holds only the ticks you gave it. */}
      {connections.length > 0 && (
        <Section title={t('circle.mydata.connections')}>
          {connectionRows({ surfaces: connections }).map((c) => (
            <View key={c.viewPubKey} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6 }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.privacyBody}>{c.label || c.short}</Text>
                <Text style={styles.privacyBody}>
                  {c.sees
                    ? t('circle.mydata.connection_sees', { what: [...c.sees.circles, ...(c.sees.device ? [t('circle.mydata.connection_device_section')] : [])].join(', ') })
                    /* NOT "0 onderdelen": a connection that cannot read is a real shape. */
                    : t('circle.mydata.connection_acts_only')}
                </Text>
                <Text style={styles.privacyBody}>{t('circle.mydata.connection_does', { count: c.opCount })}</Text>
              </View>
              <Pressable
                testID={`mydata-unpair-${c.viewPubKey.slice(0, 8)}`}
                onPress={async () => {
                  try { await callSkill('household', 'revokeSurface', { viewPubKey: c.viewPubKey }); } catch { /* the list re-reads */ }
                  load();
                }}
              >
                <Text style={styles.actionMutedLabel}>{t('circle.mydata.connection_unpair')}</Text>
              </Pressable>
            </View>
          ))}
        </Section>
      )}

      {/* Pair a new one. Two steps, as on web: paste what the other screen shows, and only THEN
          see what you are about to hand over — deciding before you can see the choices is not
          consent. Refusals name their own reason; a newer version is told to update, never guessed. */}
      <Section title={t('circle.mydata.connection_add')}>
        <TextInput
          testID="mydata-connection-offer"
          value={offerText}
          onChangeText={setOfferText}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('circle.mydata.connection_offer_placeholder')}
          placeholderTextColor={theme.muted}
          style={styles.relayInput}
        />
        {offerText.trim() !== '' && (() => {
          const parsed = parsePairingOffer(offerText.trim());
          if (!parsed.ok) {
            return <Text style={styles.privacyBody}>{t(`circle.mydata.connection_offer_${parsed.reason}`)}</Text>;
          }
          const opChoices = connectionOpChoices({ manifests: manifestsForConnections });
          const sectionChoices = connectionSectionChoices({ circles: circlesForConnections });
          const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
          return (
            <View>
              <Text style={styles.privacyBody}>
                {t('circle.mydata.connection_recognised', { name: parsed.label || parsed.viewPubKey.slice(0, 8) })}
              </Text>
              <Text style={[styles.privacyBody, { fontWeight: '600', marginTop: 6 }]}>{t('circle.mydata.connection_may_do')}</Text>
              {opChoices.map((o) => (
                <Pressable key={o.id} testID={`mydata-op-${o.id}`} onPress={() => toggle(pickedOps, setPickedOps, o.id)}>
                  <Text style={styles.privacyBody}>{(pickedOps.includes(o.id) ? '☑ ' : '☐ ') + (o.label || o.id)}</Text>
                </Pressable>
              ))}
              <Text style={[styles.privacyBody, { fontWeight: '600', marginTop: 6 }]}>{t('circle.mydata.connection_may_see')}</Text>
              {sectionChoices.map((sc) => (
                <Pressable key={sc.id} testID={`mydata-section-${sc.id}`} onPress={() => toggle(pickedSections, setPickedSections, sc.id)}>
                  <Text style={styles.privacyBody}>
                    {(pickedSections.includes(sc.id) ? '☑ ' : '☐ ') + (sc.label || t('circle.mydata.connection_device_section'))}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                testID="mydata-connection-confirm"
                onPress={async () => {
                  const args = compileConnectionGrant({
                    viewPubKey: parsed.viewPubKey, ops: pickedOps, sections: pickedSections, label: parsed.label,
                  });
                  if (!args) return;                 // a pick that grants nothing creates nothing
                  try { await callSkill('household', 'grantSurface', { ...args, ...(parsed.nonce ? { nonce: parsed.nonce } : {}) }); }
                  catch { /* the list re-reads; a failure leaves no half-connection */ }
                  setOfferText(''); setPickedOps([]); setPickedSections([]);
                  load();
                }}
              >
                <Text style={styles.actionLabel}>{t('circle.mydata.connection_confirm')}</Text>
              </Pressable>
            </View>
          );
        })()}
      </Section>

      {/* J-CS8 — the global-address publication lock, with its cost stated alongside (web parity). */}
      {shareNknAddress != null ? (
        <Section title={t('circle.mydata.address_sharing')}>
          <Text style={styles.privacyBody}>
            {t(shareNknAddress ? 'circle.mydata.address_sharing_on' : 'circle.mydata.address_sharing_off')}
          </Text>
          <Text style={styles.privacyBody}>{t('circle.mydata.address_sharing_cost')}</Text>
          <Pressable onPress={toggleShareAddress} accessibilityRole="button" style={styles.action} testID="address-sharing-toggle">
            <Text style={styles.actionLabel}>
              {t(shareNknAddress ? 'circle.mydata.address_sharing_toggle_on' : 'circle.mydata.address_sharing_toggle_off')}
            </Text>
          </Pressable>
        </Section>
      ) : null}

      {/* Message cleanup (web parity) — the record never expires by policy; this is the explicit,
          confirmed deletion. The note says what is NOT touched: decisions/reports compact into a
          counted summary rather than disappearing. */}
      <Section title={t('circle.mydata.cleanup')}>
        <View style={styles.retentionRow}>
          {RETENTION_CHOICES_DAYS.map((days) => (
            <Pressable
              key={days}
              onPress={() => { setCleanupDays(days); setCleanupResult(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: days === cleanupDays }}
              style={[styles.retentionChoice, days === cleanupDays && styles.retentionChoiceOn]}
              testID={`cleanup-${days}`}
            >
              <Text style={[styles.retentionChoiceText, days === cleanupDays && styles.retentionChoiceTextOn]}>
                {t('circle.mydata.cleanup_older_than', { days })}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={runCleanup} accessibilityRole="button" style={styles.action} testID="cleanup-run">
          <Text style={styles.actionLabel}>{t('circle.mydata.cleanup_button', { days: cleanupDays })}</Text>
        </Pressable>
        {cleanupResult != null ? (
          <Text style={styles.privacyBody}>{t('circle.mydata.cleanup_done', { count: cleanupResult })}</Text>
        ) : null}
        <Text style={styles.privacyBody}>{t('circle.mydata.cleanup_note')}</Text>
      </Section>

      {/* The personal history mirror — live health from the agent; the toggle flips the
          history.mirror register param through the one kind-gated write (the agent starts/stops
          the sink LIVE). Web parity: circleMyData.js's history section. Omitted without an agent. */}
      {agent && typeof agent.historyMirrorStatus === 'function' ? (() => {
        const on = agent.getParamValue?.('history.mirror') === true;
        const hs = agent.historyMirrorStatus();
        const stateLine = !on ? t('circle.mydata.history_off')
          : hs?.lastError ? t('circle.mydata.history_error', { error: hs.lastError })
          : hs ? t('circle.mydata.history_on', { count: (hs.mirrored ?? 0) + (hs.pending ?? 0) })
          : t('circle.mydata.history_waiting');
        return (
          <Section title={t('circle.mydata.history')}>
            <Text style={styles.privacyBody} testID="mydata-history-status">{stateLine}</Text>
            <Text style={styles.privacyBody}>{t('circle.mydata.history_what')}</Text>
            <Pressable style={styles.action} testID="mydata-history-toggle"
              onPress={async () => {
                try { await callSkill('params', 'set-param', { key: 'history.mirror', value: !on }); } catch { /* the row re-reads the truth */ }
                setTimeout(() => setHistoryTick((n) => n + 1), 400);
                setHistoryTick((n) => n + 1);
              }}>
              <Text style={styles.actionLabel}>{on ? t('circle.mydata.history_disable') : t('circle.mydata.history_enable')}</Text>
            </Pressable>
            {typeof agent.exportHistoryArchive === 'function' ? (
              <Pressable style={styles.action} testID="mydata-history-export"
                onPress={async () => {
                  try {
                    const json = await agent.exportHistoryArchive();
                    await Share.share({ message: json, title: 'onderling-geschiedenis.json' });
                  } catch { /* dismissed or no share target — nothing to report */ }
                }}>
                <Text style={styles.actionLabel}>{t('circle.mydata.history_export')}</Text>
              </Pressable>
            ) : null}
          </Section>
        );
      })() : null}

      <Section title={t('circle.mydata.notifications')}>
        <Text style={styles.privacyBody}>
          {!push.supported ? t('circle.mydata.notif_unsupported')
            : push.granted ? t('circle.mydata.notif_on') : t('circle.mydata.notif_off')}
        </Text>
        {/* J-CS10 — the trade is made by turning this ON, so it is stated HERE, above the button, in
            both states: someone reviewing their settings should be able to see what having it on means.
            Three lines on purpose — the cost, what is still not learned (a bare "affects your privacy"
            invites imagining worse than the truth), and the escape. Deliberately not framed as a
            warning: most people should turn notifications on. → docs/decisions.md 2026-07-29 */}
        {push.supported ? (
          <>
            <Text style={styles.privacyBody} testID="mydata-notif-privacy">{t('circle.mydata.notif_privacy')}</Text>
            <Text style={styles.privacyBody}>{t('circle.mydata.notif_privacy_not')}</Text>
            <Text style={styles.privacyBody}>{t('circle.mydata.notif_privacy_escape')}</Text>
          </>
        ) : null}
        {push.supported ? (
          <Pressable style={styles.action} onPress={toggleNativePush} testID="mydata-notif-toggle">
            <Text style={styles.actionLabel}>{push.granted ? t('circle.mydata.notif_disable') : t('circle.mydata.notif_enable')}</Text>
          </Pressable>
        ) : null}
      </Section>

      {/* Display theme (systeem / licht / donker) — a mono pill segmented control,
          mirror of web's Mij toggle + onderling.org's header toggle. Reuses the
          shared circle.mydata.theme(_system/_light/_dark) keys; switches live. */}
      <Section title={t('circle.mydata.theme')}>
        <View style={styles.themeToggle} accessibilityLabel={t('circle.mydata.theme')} testID="mydata-theme-toggle">
          {['system', 'light', 'dark'].map((opt) => (
            <Pressable
              key={opt}
              accessibilityRole="button"
              accessibilityState={{ selected: opt === themePref }}
              style={[styles.themeBtn, opt === themePref && styles.themeBtnActive]}
              onPress={() => setThemePref(opt)}
              testID={`mydata-theme-${opt}`}
            >
              <Text style={[styles.themeBtnText, opt === themePref && styles.themeBtnTextActive]}>
                {t(`circle.mydata.theme_${opt}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title={t('circle.mydata.surface_pref')}>
        {['inline', 'screen', 'chat'].map((opt) => (
          <Pressable
            key={opt}
            style={[styles.action, opt === surfacePref && styles.actionActive]}
            onPress={() => setPref(opt)}
            testID={`mydata-pref-${opt}`}
          >
            <Text style={[styles.actionLabel, opt === surfacePref && styles.actionActiveLabel]}>
              {t(`circle.mydata.surface_pref_${opt}`)}
            </Text>
          </Pressable>
        ))}
        {/* S6.D — when "chat" is chosen, show whether AI is enriching it here. */}
        {surfacePref === 'chat' && chatAi?.reason ? (
          <Text style={styles.privacyBody}>
            {chatAi.enriched ? '✨ ' : ''}{t(`circle.mydata.${CHAT_AI_KEY[chatAi.reason] ?? 'chat_ai_no_provider'}`)}
          </Text>
        ) : null}
      </Section>

      {/* global app language (NL/EN) — a user preference, applies app-wide (web≡mobile). */}
      <Section title={t('circle.mydata.language')}>
        {['nl', 'en'].map((lg) => (
          <Pressable
            key={lg}
            style={[styles.action, lg === lang() && styles.actionActive]}
            onPress={() => setLang(lg)}
            testID={`mydata-lang-${lg}`}
          >
            <Text style={[styles.actionLabel, lg === lang() && styles.actionActiveLabel]}>{lg.toUpperCase()}</Text>
          </Pressable>
        ))}
      </Section>

      {typeof onSaveUserLlm === 'function' && (
        <Section title={t('circle.userLlm.title')}>
          <UserLlmSettings current={userLlm || {}} onSave={onSaveUserLlm} validate={validateUserLlm} />
        </Section>
      )}

      {privacy.length > 0 && (
        <Section title={t('circle.mydata.privacy')}>
          {privacy.map((s, i) => (
            <View key={s.key ?? i} style={styles.privacy}>
              <Text style={styles.privacyTitle}>{s.title}</Text>
              <Text style={styles.privacyBody}>{s.body}</Text>
            </View>
          ))}
        </Section>
      )}

      {usage.length > 0 && (
        <Section title={t('circle.mydata.usage')}>
          {usage.map(([k, v]) => <KV key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />)}
        </Section>
      )}

      <EncryptedBackupWizardModal visible={wizard === 'backup'} callSkill={callSkill} t={t} onClose={() => setWizard(null)} onDispatched={() => {}} />
      <RestoreFromMnemonicWizardModal visible={wizard === 'restore'} callSkill={callSkill} t={t} onClose={() => setWizard(null)} onDispatched={() => {}} />
      <EnrollDeviceModal visible={wizard === 'enroll'} callSkill={callSkill} onClose={() => setWizard(null)} />
      <RevokeDeviceModal
        visible={!!revokeTarget}
        deviceId={revokeTarget}
        callSkill={callSkill}
        onClose={() => { setRevokeTarget(null); load(); }}
      />

      {/* S5 — one-time recovery-phrase reveal (stoop getMnemonicOnce). */}
      <Modal visible={!!mnemonic} animationType="fade" transparent onRequestClose={() => setMnemonic(null)}>
        <Pressable style={styles.mBackdrop} onPress={() => setMnemonic(null)}>
          <Pressable style={styles.mCard} onPress={(e) => e.stopPropagation()} testID="mydata-mnemonic-reveal">
            <Text style={styles.mTitle}>{t('circle.mydata.mnemonic_title')}</Text>
            {mnemonic?.words
              ? (<>
                  <Text style={styles.mWarn}>{t('circle.mydata.mnemonic_warn')}</Text>
                  <Text style={styles.mWords} selectable>{mnemonic.words}</Text>
                </>)
              : (<Text style={styles.mWarn}>{t('circle.mydata.mnemonic_none')}</Text>)}
            <Pressable style={styles.action} onPress={() => setMnemonic(null)}>
              <Text style={styles.actionLabel}>{t('common.close')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.paper },
  content: { padding: 16, gap: 16, paddingBottom: 80 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  back: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  section: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 8, backgroundColor: theme.color.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: theme.color.inkSoft },
  kv: { flexDirection: 'row', gap: 10 },
  k: { flex: 0.35, fontSize: 13, color: theme.color.inkSoft },
  v: { flex: 1, fontSize: 13, color: theme.color.ink },
  privacy: { gap: 2 },
  privacyTitle: { fontSize: 13, fontWeight: '600', color: theme.color.ink },
  privacyBody: { fontSize: 13, color: theme.color.inkSoft, lineHeight: 18 },
  // P1 §4 tail — the retention choice row (web parity).
  retentionRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  retentionChoice:      { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.color.line },
  retentionChoiceOn:    { backgroundColor: theme.color.card, borderColor: theme.color.ink },
  retentionChoiceText:  { fontSize: 12.5, color: theme.color.inkSoft },
  retentionChoiceTextOn:{ color: theme.color.ink, fontWeight: '600' },
  relayEdit: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  relayInput: { flex: 1, fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  relaySave: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.terracotta },
  relaySaveText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  relayNote: { marginTop: 6, fontSize: 12, color: theme.color.ink },
  relayHint: { marginTop: 4, fontSize: 12, color: theme.color.inkMuted ?? theme.color.ink },
  signin: { marginTop: 10, gap: 8 },
  signinInput: { fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  signinErr: { fontSize: 12, color: '#b3261e' },
  // Display-theme pill toggle (mono, ink-outlined; active inverts to ink) —
  // mirror of web's .cc-mydata__theme-toggle / onderling.org's #theme-toggle.
  themeToggle:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignSelf: 'flex-start' },
  themeBtn:          { borderWidth: 1.5, borderColor: theme.color.ink, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12, backgroundColor: 'transparent' },
  themeBtnActive:    { backgroundColor: theme.color.ink },
  themeBtnText:      { fontFamily: theme.font.mono, fontSize: 11.5, color: theme.color.ink },
  themeBtnTextActive:{ color: theme.color.card, fontWeight: '700' },
  action: { alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.color.accent, borderRadius: theme.radius.md, paddingVertical: 8, paddingHorizontal: 14 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
  actionActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  actionActiveLabel: { color: theme.color.white },
  actionMuted: { borderColor: theme.color.line },
  actionMutedLabel: { fontSize: 13, fontWeight: '600', color: theme.color.inkSoft },
  mBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  mCard: { backgroundColor: theme.color.paper, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line, padding: 18, gap: 12 },
  mTitle: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink },
  mWarn: { fontSize: 13, color: theme.color.inkSoft, lineHeight: 18 },
  mWords: { fontSize: 15, lineHeight: 24, color: theme.color.ink, borderWidth: 1, borderColor: theme.color.line, borderStyle: 'dashed', borderRadius: theme.radius.md, padding: 12 },
});
