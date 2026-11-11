/**
 * mobileNode — a PHONE in Node: the phone's own boot and its own inbound wiring, over a test relay.
 *
 * What a story in the function matrix's M form runs on ("the phone does X, the other side sees it"). It is the phone,
 * not a reassembly of it:
 *   - the agent comes from the phone's `bootAgentBundle` (src/core/agentBundle.js), given the options App.js gives it,
 *     built with the same factories (the device log and its sealed store, the admission membrane, the give-up
 *     consumers, the circle pods, the registry backend). `phoneBootParity.test.js` holds this file to App.js's list;
 *   - the receive path is the phone's own composition, `buildPhoneInboundWiring` (src/core/phoneInboundWiring.js) —
 *     the function ChatScreen calls — with the screen's paint replaced by recorders;
 *   - the ops on the waist are the phone's own mount, `mountPhoneAppOps` (src/core/phoneAppOps.js) — the function the
 *     launcher calls — with the platform (picker, scanner, dialogs) recorded, and the picker fed by the story;
 *   - the relay is the one the phone's settings name: written into ITS storage before boot, dialled by the boot's own
 *     connect (no second dial from here).
 *
 * Two departures, both below the phone's code:
 *   - NKN never dials: `nknLib` is a stub client that never connects (the bundle's own test seam, `opts.nknLib`, the
 *     one bootSmoke uses), so delivery runs over the relay alone, as on a phone whose NKN is down;
 *   - each phone gets its OWN module graph (`vi.resetModules()` before its imports). A phone is its own process: the
 *     AsyncStorage stub, the circle pods' vault and producers, every module-level store are per phone here too. Two
 *     phones sharing one graph would share all of that and prove nothing about two devices.
 *
 * Not composed (screen-only, no state a story reads): the catch-up kicks ChatScreen fires once per launch on timers
 * (`globalThis` flags — per process, so the second phone would skip them), the restore flows, the theme, the pod
 * sign-in. A story that needs a catch-up calls it through `node.bundle.laneCatchUps`.
 */
import { vi } from 'vitest';

const stubNknLib = {
  // never emits 'connect': the NKN leg stays down and routing uses the relay
  MultiClient: class { constructor() {} on() {} close() {} },
};

const until = async (pred, { timeoutMs, what }) => {
  const t0 = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`mobileNode: timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => { setTimeout(r, 50); });
  }
};

/**
 * Boot one phone.
 * @param {object} p
 * @param {string} p.name           a label (also the device name recorded at enrolment)
 * @param {string} p.relayUrl       the test relay (`startJourneyRelay().url`)
 * @param {number} [p.connectTimeoutMs=20000]
 * @returns {Promise<object>} the node: { name, bundle, agent, callSkill, address, eventLog, deliveryMap, landed, dispose }
 *   `address` is the phone's chat key, the address a peer sends to. `landed` records what the screen would paint:
 *   `contactReplies` (the contact-thread inbox), `mainBubbles` (calendar lines), `unrouted` (envelopes the router
 *   handed to the default handler), `catchUpOffers` (the consent question; allowed by default, as a tap would).
 */
export async function bootMobileNode({ name, relayUrl, connectTimeoutMs = 20_000 }) {
  if (!name || !relayUrl) throw new Error('bootMobileNode: name and relayUrl are required');
  vi.resetModules();
  const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
  const { bootAgentBundle } = await import('../../src/core/agentBundle.js');
  const { buildPhoneInboundWiring } = await import('../../src/core/phoneInboundWiring.js');
  const { mountPhoneAppOps } = await import('../../src/core/phoneAppOps.js');
  const { subscribeContactReplies } = await import('../../src/core/contactReplyInbox.js');
  const pods = await import('../../src/core/circlePods.js');
  const { asyncStorageMappingsStore, MAPPINGS_DEVICE } = await import('../../src/core/mappingsStoreRN.js');
  const { makeMemberOverrideStoreRN, makeCirclePolicyStoreRN } = await import('../../src/core/circleStoresRN.js');
  const { makeCircleRecipePendingStoreRN } = await import('../../src/core/circleRecipePendingStorageRN.js');
  const { makeCircleRulesPendingStoreRN } = await import('../../src/core/circleRulesPendingStorageRN.js');
  const { t } = await import('../../src/core/localisation.js');
  const { createAsBackend } = await import('@onderling/react-native/pseudo-pod-adapter');
  const { createDeliveryStateMap } = await import('@onderling/kring-host/deliveryState');
  const { EventLog } = await import('../../../basis/src/eventLog.js');
  const { makeGiveUpConsumers } = await import('../../../basis/src/v2/deliveryGiveUp.js');
  const { makeCircleMembraneOpts, makeCircleGroupsIndex } = await import('../../../basis/src/v2/circleMembrane.js');
  const { sealedLocalBackend } = await import('../../../basis/src/v2/localStoreSeal.js');
  const { backendSnapshotIo } = await import('../../../basis/src/v2/eventLogPersistence.js');
  const { createSettingsPodMedium } = await import('../../../basis/src/v2/settingsPodMedium.js');
  const { createHistoryPodMedium } = await import('../../../basis/src/v2/historyMirror.js');
  const { createRegistryPodMedium } = await import('../../../basis/src/v2/registryCarrier.js');
  const { makeCirclePolicyLane, makePolicyHeadStore, adminsOfViaSkill } = await import('../../../basis/src/v2/policyUpdateLane.js');
  const { asyncStorageRelayIo } = await import('../../../basis/src/v2/relayPref.js');
  const { makePeerRouter } = await import('../../../basis/src/core/handlers/peerRouter.js');
  const {
    makeReceiptSender, asyncStorageDeliveryIo, createDeliverySettingsStore, retentionFromDays,
  } = await import('@onderling-app/basis');

  // ── what App.js builds before the boot ───────────────────────────────────────────────────────────────────────
  let bundle = null;
  const eventLog = new EventLog({ initial: [], muted: [] });
  const deliveryMap = createDeliveryStateMap();
  const groupsIndex = makeCircleGroupsIndex();
  const deliverySettings = createDeliverySettingsStore(asyncStorageDeliveryIo(AsyncStorage));
  let deliverySettingsCache = { sendReceipts: true, allowFallback: false };
  deliverySettings.get().then((s) => { deliverySettingsCache = s; }).catch(() => {});
  const chatStoredReceipt = makeReceiptSender({
    getSettings: () => deliverySettings.get(),
    sendTo: (to, payload, opts = {}) => (typeof bundle?.agent?.sendPeerMessage === 'function'
      ? bundle.agent.sendPeerMessage(to, payload, opts)
      : Promise.reject(new Error('no peer send yet'))),
  });
  const recipePendingStore = makeCircleRecipePendingStoreRN(AsyncStorage);
  const rulesPendingStore = makeCircleRulesPendingStoreRN(AsyncStorage);
  pods.initCirclePods(AsyncStorage);
  const policyStore = makeCirclePolicyStoreRN(AsyncStorage);
  const circlePolicyLane = makeCirclePolicyLane({
    emitter: () => bundle?.agent?.emitPolicyUpdate ?? null,
    headStore: makePolicyHeadStore(AsyncStorage),
    readPolicy: (cid) => policyStore.get(cid),
    writePolicy: async (cid, policy) => { const r = await policyStore.update(cid, policy); pods.forgetCircleSealStrategyFor(cid); return r; },
    adminsOf: adminsOfViaSkill((...a) => bundle?.callSkill?.(...a)),
  });

  // the relay this phone is set to — in ITS storage, read by the boot's own connect
  await asyncStorageRelayIo(AsyncStorage).save(relayUrl);

  // ── the boot, with App.js's options (phoneBootParity.test.js holds the list to App.js) ─────────────────────
  const flags = { settingsKeyMismatch: 0, settingsConflicts: 0, registryKeyMismatch: 0 };
  let eventSeq = 0;
  bundle = await bootAgentBundle({
    t,
    secureAgentOpts: {
      ...makeGiveUpConsumers({ deliveryMap }),
      ...makeCircleMembraneOpts({ overrideStore: makeMemberOverrideStoreRN(AsyncStorage), groupsIndex }),
    },
    allowAddressFallback: () => deliverySettingsCache.allowFallback === true,
    circlesForPeer: (addr) => groupsIndex.groupsFor(addr),
    asyncStorage: AsyncStorage,
    onSettingsKeyMismatch: () => { flags.settingsKeyMismatch += 1; },
    onSettingsConflicts: () => { flags.settingsConflicts += 1; },
    getSharedWithMePodWriter: () => null,   // not signed in to a pod
    pinboardControlAgent: pods.circleControlAgentRouter,
    provisionCircleMedium: pods.provisionCircleMedium,
    deviceLog: eventLog,
    deviceLogIo: backendSnapshotIo(sealedLocalBackend(createAsBackend({ AsyncStorage, scope: 'cc-device-log' }))),
    enrolDeviceName: () => name,
    provisionSettingsMedium: async (strategy) => createSettingsPodMedium({
      fetch: pods.getCirclePodFetch(), podRoot: pods.getActiveRealPodRouting()?.podRoot ?? null, strategy,
    }),
    registryBackend: createAsBackend({ AsyncStorage, scope: 'cc-agent-registry' }),
    provisionRegistryMedium: async (strategy) => createRegistryPodMedium({
      fetch: pods.getCirclePodFetch(), podRoot: pods.getActiveRealPodRouting()?.podRoot ?? null, strategy,
    }),
    onRegistryKeyMismatch: () => { flags.registryKeyMismatch += 1; },
    provisionHistoryMirror: async (strategy) => createHistoryPodMedium({
      fetch: pods.getCirclePodFetch(), podRoot: pods.getActiveRealPodRouting()?.podRoot ?? null, strategy,
    }),
    pinboardCircleDataMove: pods.circleSendDataMove,
    pinboardPodWrite: pods.circlePodWrite,
    podWebId: pods.getCirclePodWebId,
    setKeyEventWiring: pods.setCircleKeyEventWiring,
    mappingsStore: asyncStorageMappingsStore(AsyncStorage),
    mappingsDeviceId: MAPPINGS_DEVICE,
    // a first launch: the demo seed runs, as on a fresh install
    seedTasks: true,
    seedPinboardProfile: true,
    seedPinboardPosts: true,
    publishEvent: (e) => {
      if (!e || typeof e !== 'object') return;
      try { eventLog.append({ ...e, id: e.id ?? `mob-${Date.now()}-${(eventSeq += 1).toString(36)}`, ts: e.ts ?? Date.now() }); }
      catch { /* defensive */ }
    },
    nknLib: stubNknLib,   // test-only: NKN never dials (see the head of this file)
  });

  // ── what App.js does once the bundle is up ───────────────────────────────────────────────────────────────────
  try {
    bundle.nearbyRoom?.setLandedHook?.((info) => chatStoredReceipt(info));
    bundle.nearbyRoom?.setDeliveryMap?.(deliveryMap);
  } catch { /* the room works without receipts */ }
  await bundle.callSkill?.('params', 'get-param', { key: 'retention.chatDays' })
    .then((r) => eventLog.setRetention?.(retentionFromDays(r?.value)))
    .catch(() => {});
  if (bundle.agent) bundle.agent._circleGroupsIndex = groupsIndex;

  // ── what ChatScreen attaches: the phone's own inbound wiring, paint recorded ───────────────────────────────────
  const landed = { contactReplies: [], mainBubbles: [], unrouted: [], catchUpOffers: [] };
  const unsubscribe = subscribeContactReplies((reply) => { landed.contactReplies.push(reply); });
  const { handlers } = buildPhoneInboundWiring({
    bundle, agent: bundle.agent, callSkill: bundle.callSkill,
    contactChannel: bundle.contactChannel,
    pendingRedeems: bundle.pendingPeerRedeems,
    sharedWithMeStore: bundle.sharedWithMeStore ?? null,
    eventLog, deliveryStateMap: deliveryMap, chatStoredReceipt,
    onCirclesChanged: () => {},
    recipe: { pendingStore: recipePendingStore, dedup: new Set() },
    rules: { pendingStore: rulesPendingStore, dedup: new Set() },
    circlePolicyLane,
    paint: {
      addMainBubble: (bubble) => { landed.mainBubbles.push(bubble); },
      chatCatchUpOffer: ({ count, approxBytes, allow }) => {
        landed.catchUpOffers.push({ count, approxBytes });
        Promise.resolve(allow()).catch(() => {});
      },
    },
  });
  bundle.attachPeerWiring({
    onPeerMessage: makePeerRouter({ handlers, defaultHandler: (env) => { landed.unrouted.push(env); } }),
  });

  // ── what the launcher mounts: the phone's own ops on the waist (src/core/phoneAppOps.js), its platform recorded ─
  // The file picker is the story's: `node.pickNext(file)` hands the next pick the shape the phone's picker returns
  // ({ name, type, size, dataB64 }); with nothing queued a pick is a cancel, as a person backing out of the picker.
  const picks = [];
  const asked = { qrScans: 0, feedback: [], personCards: [] };
  let openCircle = null;
  mountPhoneAppOps({
    agent: bundle.agent, catalogue: bundle.catalogue, callSkill: bundle.callSkill, t, eventLog,
    activeCircle: () => openCircle,
    platform: {
      openFilePicker: async () => picks.shift() ?? null,
      openQrScanner: () => { asked.qrScans += 1; },
      openFeedback: (a) => { asked.feedback.push(a); },
      confirmFeedbackOffer: async () => true,   // the person taps yes
      feedbackCard: null,
      appVersion: 'test',
      currentScreen: () => null,
      showPersonCard: (card) => { asked.personCards.push(card); },
    },
  });

  // ── on the relay: the boot's own connect, awaited ────────────────────────────────────────────────────────────
  // (`agent.relay` names the primary relay but carries no socket state; the per-relay list does)
  const onRelay = () => (bundle.agent?.relays?.list?.() ?? []).some((r) => r.url === relayUrl && r.connected === true);
  await until(onRelay, { timeoutMs: connectTimeoutMs, what: `${name} on the relay ${relayUrl}` });

  return {
    name,
    bundle,
    agent: bundle.agent,
    callSkill: bundle.callSkill,
    address: bundle.agent?.identity?.chat?.pubKey ?? null,
    // the same key under the name the relay-test helpers read (`createCircle`, `joinExistingCircle`), so a phone can
    // stand in any of their roles
    pubKey: bundle.agent?.identity?.chat?.pubKey ?? null,
    eventLog,
    deliveryMap,
    storage: AsyncStorage,
    flags,
    landed,
    asked,
    /** Queue the next file the phone's picker returns ({ name, type, size, dataB64 }). */
    pickNext: (file) => { picks.push(file); },
    /** Which circle the launcher has open (the lists write there). */
    openCircle: (circleId) => { openCircle = circleId; },
    async dispose() {
      unsubscribe?.();
      await bundle.dispose?.();
    },
  };
}
