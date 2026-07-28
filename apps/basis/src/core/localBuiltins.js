/**
 * basis — chat-shell built-in skill handlers.
 *
 * Some ops declared on basis's own manifest (`/help` today,
 * `/brief` + `/threads` in later phases) don't dispatch to any
 * app agent.  They're handled LOCALLY by the chat shell: the
 * handler reads from the merged catalog + chat-shell state and
 * returns a regular skill payload.
 *
 * Pattern: pass `catalog` + `t` into `createLocalBuiltins`; the
 * returned object maps `(opId) → handler(args) → payload`.
 * `web/main.js` checks `appOrigin === 'basis'` in callSkill
 * and routes to one of these handlers; everything else goes to the
 * real agent.
 *
 * Phase v0.1+ — companion to the manifest definitions in
 * `apps/basis/manifest.js`.
 */

import { describeFilter }    from '../filter.js';
import { buildEmbed }        from '../embed.js';
import { openExternalFlow }  from '../externalFlow.js';
import { compareForCuration } from '../v2/curation.js';   // `compare` op handler
// Media Phase 1 (2026-07) — sealed media path for picked images (chat → blob-gateway).
import { createMediaEmbed, hasMediaGateway, isImageMime } from './handlers/mediaEmbed.js';

// lazy chrono import for createTimeEmbed's
// natural-language fallback.  Lazy because the parseDate module
// pulls in chrono-node (~70KB) and only /embed-time needs it.
let _parseDateAndTime;
async function parseDateLazy(input) {
  if (!_parseDateAndTime) {
    _parseDateAndTime = (await import('../forms/parseDate.js')).parseDateAndTime;
  }
  try { return _parseDateAndTime(input); } catch { return null; }
}

/**
 * Build the local-builtins dispatcher.
 *
 * @param {object} deps
 * @param {import('../manifestMerge.js').MergedCatalog} deps.catalog
 * @param {(key: string, params?: object) => string}   deps.t
 * @param {import('../threadStore.js').ThreadStore}    [deps.threadStore]
 *   Required for /newthread and /threads.
 * @param {(threadId: string) => void}                 [deps.setActive]
 *   Called by /newthread to switch active thread to the new one.
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} [deps.callSkill]
 *   Required for /embed — fetches the snapshot via the catalog's
 *   declaration.
 * @returns {{[opId: string]: (args: object) => Promise<*>}}
 */
export function createLocalBuiltins({
  catalog, t, threadStore, setActive, callSkill, localActor,
  simPeers,                  // v0.5.6 — { '<peer>': { threadId, webid } }
  appRegistry,               // v0.6 OQ-4.B
  externalFlow,              // v0.6.2 — { open, getActiveThreadId, mockSigninUrl }
  briefRunner,               // v0.7 — () => Promise<BriefReply>
  eventLog,                  // v0.7.1 — EventLog instance
  openLogsPanel,             // v0.7.1c — () => void (opens side-panel)
  findRunner,                // v0.7.5 — ({query}) => Promise<FindReply>
  openFilePicker,            // v0.7.13 — () => Promise<File|null>
  openQrScanner,             // 2026-05-27 — () => void (mobile: opens scanner modal)
  podAuth,                   // v0.7. — real Solid OIDC wrapper
  onSignOut,                 // v0.7. — cleanup hook for the pod writer
  agent,                     // v0.7.P3a — agent {identity:{host,chat}}
  connectPeer,               // v0.7.P3b — () => Promise<{address}>
  lookupPeerAddrByWebid,      // v0.7.P3d — (webid) => Promise<string|null>
  publishPeerAddrToPod,       // v0.7.P3d — () => Promise<{ok, url, status}>
  mediaGateway,               // media — { bucket, sealer, opener?, keyRef? } (blob-gateway seams; injected by composition)
  encodeImage,                // media — web canvas encoder (attachmentEncoder.encodeImageFile); optional
  storeMediaItem,             // media — item-store seam for the `media` item; optional (absent ⇒ item rides on the embed)
}) {
  return {
    help: async () => formatHelp(catalog, t),
    newthread: async (args) => createNewThread(args, { threadStore, setActive, t }),
    threads:   async ()     => listThreads({ threadStore, t }),
    // dm <webid> opens a DM thread with the given peer.
    // Same outcome as the [DM] row button (which intercepts in main.js).
    startDm:   async (args) => createDmThread(args, { threadStore, setActive, t }),
    embed:     async (args) => createEmbed(args, { catalog, callSkill, t, localActor }),
    'embed-file': async (args) => createFileEmbed(args, {
      localActor, t, simPeers, threadStore, callSkill, openFilePicker,
      mediaGateway, encodeImage, storeMediaItem,
    }),
    'embed-time': async (args) => createTimeEmbed(args, { localActor, t, simPeers, threadStore, callSkill }),
    sendto:    async (args) => sendToPeer(args, {
      catalog, callSkill, t, localActor, simPeers, threadStore,
    }),
    apps:      async (args) => appsToggle(args, { catalog, appRegistry, t }),
    // v0.7.5 / v0.7.1c — also expose openLogsPanel reachable to
    // handlers (currently only used by /logs but reads well at this
    // layer).
    signin:    async (args) => signinFlow(args, { podAuth, externalFlow, t }),
    whoami:    async (args) => whoami(args, { podAuth, t }),
    me:        async (args) => meIdentity(args, { agent, t }),
    'peer-connect':     async (args) => peerConnect(args, { connectPeer, t }),
    'test-peer':        async (args) => testPeer(args, { agent, t }),
    'rotate-identity':  async (args) => rotateIdentity(args, { agent, t }),
    'security-status':  async (args) => securityStatus(args, { agent, t }),
    'set-relay':        async (args) => setRelay(args, { agent, t }),
    'transport-mode':   async (args) => transportMode(args, { agent, t }),
    'transports':       async ()     => transportsStatus({ agent, t }),
    'settings':         async (args) => settingsHandler(args, { t }),
    'lookup-peer':      async (args) => lookupPeer(args, { lookupPeerAddrByWebid, t }),
    'publish-peer':      async (args) => publishPeerAddrCmd(args, { publishPeerAddrToPod, t }),
    'send-file':        async (args) => sendFile(args, {
      agent, t, openFilePicker, lookupPeerAddrByWebid,
    }),
    mute:               async (args) => muteHandler(args, { agent, t }),
    unmute:             async (args) => unmuteHandler(args, { agent, t }),
    muted:              async (args) => mutedHandler(args, { agent, t }),
    'audit-tail':       async (args) => auditTailHandler(args, { agent, t }),
    'help-with':        async (args) => helpWithPost(args, { threadStore, setActive, t }),
    'debug-dump':       async ()     => debugDump({ agent, t }),
    signout:   async (args) => signOutFlow(args, { podAuth, t, onSignOut }),
    'reset-thread': async () => {
      // v0.7.-followup — clear the active thread's messages.
      // 2026-05-27 slash audit close-out — distinguish "no store"
      // (threadStore not wired in this build) from "no active thread"
      // (store wired but nothing selected).  Two distinct conditions
      // → two distinct locale keys.
      if (!threadStore) return { ok: false, error: t('reset.no_store') };
      const active = threadStore.getActiveThread?.();
      if (!active) return { ok: false, error: t('reset.no_thread') };
      active.messages = [];
      active._listings?.clear?.();
      // Fire onChange so IDB persistence catches up.
      active._notifyChange?.('reset');
      return { ok: true, message: t('reset.done') };
    },
    brief:     async (args) => runBriefBuiltin(args, { briefRunner, t }),
    logs:      async (args) => runLogsBuiltin(args, { eventLog, t, openLogsPanel }),
    find:      async (args) => runFindBuiltin(args, { findRunner, t }),
    scanQr:    async ()     => runScanQrBuiltin({ openQrScanner, t }),
    // before/after curation; returns a compareForCuration payload, rendered
    // via the manifest's `curation` reply shape.
    compare:   async (args) => compareForCuration(args?.before, args?.after),
  };
}

/**
 * `/scan-qr` — open the camera so the user can scan a stoop-contact://
 * or stoop-invite:// URL.  Mobile-only today; web returns a hint.
 */
async function runScanQrBuiltin({ openQrScanner, t }) {
  if (typeof openQrScanner !== 'function') {
    return { ok: false, error: t('scan_qr.not_available') };
  }
  openQrScanner();
  return { ok: true, message: t('scan_qr.opening') };
}

async function runFindBuiltin(args, { findRunner, t }) {
  const q = String(args?.query ?? args?._match ?? '').trim();
  if (!q) return { ok: false, error: t('find.no_query') };
  if (typeof findRunner !== 'function') {
    return { ok: false, error: t('find.no_runner') };
  }
  return findRunner({ query: q });
}

/**
 * `/logs [--app=X] [--type=Y] [--actor=Z] [--since=ISO] [--mute=app:type] [--limit=N]`
 * v0.7.1 — list recent network events from the EventLog (14d retention).
 * `--mute` is a side-effect: adds the kind to the mute set + reports.
 */
async function runLogsBuiltin(args, { eventLog, t, openLogsPanel }) {
  if (!eventLog) return { ok: false, error: t('logs.no_log') };

  // v0.7.1c — bare /logs opens the side-panel; --inline reverts to
  // the v0.7.1b chat-inline list; --mute=app:type keeps working
  // either way.
  if (typeof args?.mute === 'string' && args.mute.includes(':')) {
    const [app, type] = args.mute.split(':', 2);
    eventLog.mute(app, type);
    return { ok: true, message: t('logs.muted', { app, type }) };
  }

  const hasFilterFlag =
       !!args?.app   || !!args?.type || !!args?.actor
    || !!args?.since || typeof args?.limit === 'number'
    || !!args?.inline;
  if (!hasFilterFlag && typeof openLogsPanel === 'function') {
    openLogsPanel();
    return { ok: true, message: t('logs.panel_opened') };
  }

  // Build filter from flag args.
  const filter = {};
  if (typeof args?.app   === 'string' && args.app   !== '') filter.apps       = [args.app];
  if (typeof args?.type  === 'string' && args.type  !== '') filter.eventTypes = [args.type];
  if (typeof args?.actor === 'string' && args.actor !== '') filter.actors     = [args.actor];

  // since: accept ISO date string OR 'today' / 'yesterday'.
  let since;
  if (typeof args?.since === 'string' && args.since !== '') {
    const lower = args.since.trim().toLowerCase();
    if (lower === 'today') {
      const d = new Date(); d.setHours(0,0,0,0); since = d.getTime();
    } else if (lower === 'yesterday') {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - 1);
      since = d.getTime();
    } else {
      const parsed = new Date(args.since);
      if (!Number.isNaN(parsed.getTime())) since = parsed.getTime();
    }
  }

  const limit = typeof args?.limit === 'number' ? args.limit : 20;
  const events = eventLog.query({
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    since,
    excludeMuted: true,
    limit,
  });

  if (events.length === 0) {
    return { ok: true, message: t('logs.empty') };
  }
  return {
    items: events.map((e) => ({
      id:    e.id,
      label: formatLogRow(e),
    })),
    message: t('logs.heading', { count: events.length }),
  };
}

function formatLogRow(e) {
  const time = new Date(e.ts).toISOString().slice(11, 16);   // HH:MM
  const date = new Date(e.ts).toISOString().slice(5, 10);    // MM-DD
  const actor = e.actor ? ` ${e.actor}` : '';
  const text  = e.payload?.message ?? e.payload?.text ?? `[${e.app}/${e.type}]`;
  return `${date} ${time}${actor} · ${text}`;
}

/**
 * `/brief [--refresh]` — v0.7 builtin.  Delegates to briefRunner
 * (closure created in web/main.js with the live callSkill +
 * cache).  The argument controls cache-bypass only.
 */
async function runBriefBuiltin(args, { briefRunner, t }) {
  if (typeof briefRunner !== 'function') {
    return { ok: false, error: t('brief.no_runner') };
  }
  return briefRunner({ bypassCache: !!args?.refresh });
}

/**
 * `/signin [--issuer=X]` — v0.7. real Solid OIDC. Triggers a
 * full-page redirect to the chosen pod issuer.  When the user
 * returns, main.js's boot handler completes the round-trip + this
 * thread gets a confirmation via the signed-in event.
 *
 * `podAuth` is the test seam — main.js passes the real podAuth
 * module; tests pass a stub.  When podAuth isn't wired (test or
 * partial build), falls back to the v0.6.2 mock externalFlow.
 */
async function signinFlow(args, { podAuth, externalFlow, t }) {
  const issuer = String(args?.issuer ?? '').trim() || undefined;

  // Real OIDC path.
  if (podAuth && typeof podAuth.startSignIn === 'function') {
    try {
      // startSignIn navigates away; the promise only resolves on error.
      const resolved = podAuth.resolveIssuer?.(issuer);
      if (resolved === null) {
        return { ok: false, error: t('signin.unknown_issuer', { issuer }) };
      }
      const name = resolved?.name ?? issuer ?? 'default';
      // Fire-and-forget — the browser is about to navigate to the
      // issuer.  Return an opening message that may briefly flash
      // before the redirect.
      podAuth.startSignIn({ issuer }).catch((err) => {
        console.error('[signin] redirect failed', err);
      });
      return { ok: true, message: t('signin.opening', { issuer: name }) };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  // Fallback (test workspace pre-v0.7. builds): the mock
  // externalFlow path.  Real builds always have podAuth wired.
  if (externalFlow && typeof externalFlow.open === 'function') {
    try {
      await externalFlow.open({ issuer: issuer ?? 'mock' });
      return { ok: true, message: t('signin.opening', { issuer: issuer ?? 'mock' }) };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  return { ok: false, error: t('signin.no_flow') };
}

/**
 * `/whoami` — v0.7.. Returns the current webid (signed in) or
 * a hint to use /signin.
 */
async function whoami(_args, { podAuth, t }) {
  if (!podAuth || typeof podAuth.getCurrentSession !== 'function') {
    return { message: t('whoami.unavailable') };
  }
  const sess = podAuth.getCurrentSession();
  if (sess) return { message: t('whoami.signed_in', { webid: sess.webid }) };
  // v0.7.P3c diagnostic — surface the RAW session state when the
  // logged-in gate fails.  Helps diagnose SolidCommunity / NSS
  // edge cases where handleRedirect returns but isLoggedIn stays
  // false (CORS, ID-token mismatch, redirect-URL drift, etc).
  if (typeof podAuth.getRawSessionInfo === 'function') {
    const raw = podAuth.getRawSessionInfo();
    if (!raw.sessionExists) return { message: t('whoami.not_signed_in') };
    const lines = ['Not signed in.  Diagnostic state:'];
    lines.push(`  sessionExists: ${raw.sessionExists}`);
    lines.push(`  isLoggedIn:    ${raw.isLoggedIn}`);
    if (raw.webId) lines.push(`  webId:         ${raw.webId}`);
    if (raw.sessionId) lines.push(`  sessionId:     ${raw.sessionId}`);
    lines.push('');
    lines.push('If you JUST returned from the issuer + this says isLoggedIn:');
    lines.push('false: the redirect-back round-trip didn\'t complete.');
    lines.push('Check DevTools console for [podAuth] errors; retry /signin.');
    return { message: lines.join('\n') };
  }
  return { message: t('whoami.not_signed_in') };
}

/**
 * `/me` — v0.7.P3a.  Returns persistent agent-identity info needed
 * to share with peers for cross-peer chat-p2p.  Format the chat
 * stableId + pubKey as a copy-pasteable block.
 */
async function meIdentity(_args, { agent, t }) {
  if (!agent?.identity?.chat) return { message: t('me.unavailable') };
  const id   = agent.identity.chat;
  const peer = agent.peer ?? {};
  const lines = [
    'Your agent identity (persists across refresh):',
    `  pubKey:    ${id.pubKey}`,
    `  stableId:  ${id.stableId ?? '(none)'}`,
  ];
  // v0.7.P3b — peer address (the thing peers send to).
  if (peer.address) {
    lines.push('');
    lines.push('Cross-peer (NKN):');
    lines.push(`  peer address: ${peer.address}`);
    lines.push('  → share this with a peer; they /test-peer <this-address> hello');
  } else if (peer.status === 'connecting') {
    lines.push('');
    lines.push('NKN: connecting… (5-90s on first connect)');
  } else if (peer.status === 'error') {
    lines.push('');
    lines.push(`NKN: connect failed — ${peer.error ?? 'unknown error'}`);
  } else {
    lines.push('');
    lines.push('NKN: not connected.  /peer-connect to enable cross-peer chat.');
  }
  return { message: lines.join('\n') };
}

/**
 * `/send-file <peer>` — v0.7.P3f.  Opens the file picker, reads
 * bytes as base64, sends as 'file-share' envelope.  Peer can be
 * an peer address ('app.<hex>') OR a webid (auto-resolved).
 */
async function sendFile(args, {
  agent, t, openFilePicker, lookupPeerAddrByWebid,
}) {
  const peerRaw = String(args?.peer ?? '').trim();
  if (!peerRaw) return { ok: false, error: t('sendFile.no_peer') };
  if (typeof openFilePicker !== 'function') {
    return { ok: false, error: t('sendFile.no_picker') };
  }
  if (typeof agent?.sendPeerMessage !== 'function' || agent.peer?.status !== 'connected') {
    return { ok: false, error: t('sendFile.not_connected') };
  }

  // Resolve peer if it looks like a webid.
  let peerAddr = peerRaw;
  if (peerRaw.startsWith('http') || peerRaw.startsWith('webid:')) {
    if (typeof lookupPeerAddrByWebid !== 'function') {
      return { ok: false, error: t('sendFile.no_lookup') };
    }
    const resolved = await lookupPeerAddrByWebid(peerRaw).catch(() => null);
    if (!resolved) return { ok: false, error: t('sendFile.lookup_failed', { peer: peerRaw }) };
    peerAddr = resolved;
  }

  // Open the file picker.
  let file;
  try {
    file = await openFilePicker();
    if (!file) return { ok: false, error: t('sendFile.cancelled') };
  } catch (err) {
    return { ok: false, error: t('sendFile.pick_failed', { error: err.message ?? String(err) }) };
  }

  // 32KB cap on inline base64.  Why 32KB and not the obvious 64KB
  // (nkn-sdk-js MaxClientMessageSize ≈ 65528 bytes)?  Base64 inflates
  // by 4/3 (32KB raw → 44KB encoded) + JSON envelope wrapping +
  // Ed25519 sig (~88 bytes) + nacl.box overhead.  32KB raw keeps the
  // wire payload comfortably below 64KB.
  //
  // Reported by Frits 2026-05-23 (manual H-1 follow-up): a 117KB
  // file went through /send-file but never arrived at the receiver
  // because the 512KB code-side cap was 2.5x over NKN's silent
  // drop threshold.  Larger-file flow (chunked transfer OR pod-URL
  // hand-off) is the next slice; for now we hard-cap at 32KB so
  // every successful /send-file actually delivers.
  const MAX_INLINE = 32 * 1024;
  if (file.size > MAX_INLINE) {
    return { ok: false, error: t('sendFile.too_large', { size: file.size, max: MAX_INLINE }) };
  }

  let dataB64;
  if (typeof file?.dataB64 === 'string' && file.dataB64.length > 0) {
    // mobile pickers pre-encode the bytes
    // (substrate `packages/react-native/src/picker` returns
    // {dataB64, ...}).  Hermes has no FileReader, so the browser
    // path below would crash on RN.  Short-circuit when the
    // picker already gave us the base64.
    dataB64 = file.dataB64;
  } else {
    try {
      dataB64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload  = () => {
          const dataUrl = String(fr.result ?? '');
          const idx = dataUrl.indexOf(',');
          resolve(idx > 0 ? dataUrl.slice(idx + 1) : dataUrl);
        };
        fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
        fr.readAsDataURL(file);
      });
    } catch (err) {
      return { ok: false, error: t('sendFile.read_failed', { error: err.message ?? String(err) }) };
    }
  }

  try {
    await agent.sendPeerMessage(peerAddr, {
      type:    'p2p-chat',
      subtype: 'file-share',
      file: {
        id:    `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name:  file.name,
        mime:  file.type || 'application/octet-stream',
        size:  file.size,
        dataB64,
      },
      sentAt: Date.now(),
    });
    return { message: t('sendFile.sent', { name: file.name, size: file.size, peer: peerAddr }) };
  } catch (err) {
    return { ok: false, error: t('sendFile.send_failed', { error: err.message ?? String(err) }) };
  }
}

/**
 * `/lookup-peer <webid>` — v0.7.P3d.  Resolves WebID → peer address
 * via the peer's pod profile.  Returns the address so the user can
 * `/test-peer` or `/addappt --attendees-addr=` with it.
 */
async function lookupPeer(args, { lookupPeerAddrByWebid, t }) {
  const webid = String(args?.webid ?? '').trim();
  if (!webid) return { ok: false, error: t('lookup.no_webid') };
  if (typeof lookupPeerAddrByWebid !== 'function') {
    return { ok: false, error: t('lookup.unavailable') };
  }
  try {
    const addr = await lookupPeerAddrByWebid(webid);
    if (!addr) return { ok: false, error: t('lookup.not_found', { webid }) };
    return { message: t('lookup.found', { webid, address: addr }) };
  } catch (err) {
    return { ok: false, error: t('lookup.failed', { error: err.message ?? String(err) }) };
  }
}

/**
 * `/publish-peer` — v0.7.P3d.  Re-publishes the user's peer address
 * to their pod identity.ttl.
 */
async function publishPeerAddrCmd(_args, { publishPeerAddrToPod, t }) {
  if (typeof publishPeerAddrToPod !== 'function') {
    return { ok: false, error: t('publishPeerAddrCmd.unavailable') };
  }
  try {
    const r = await publishPeerAddrToPod();
    if (!r?.ok) return { ok: false, error: t('publishPeerAddrCmd.failed', { status: r?.status ?? 'unknown' }) };
    return { message: t('publishPeerAddrCmd.done', { url: r.url }) };
  } catch (err) {
    return { ok: false, error: t('publishPeerAddrCmd.failed', { error: err.message ?? String(err) }) };
  }
}

/**
 * `/rotate-identity` — v0.7.P3d.  Rotates the chat-agent's Ed25519
 * keypair.  Old key stays valid for 7 days (in-flight envelopes
 * still decrypt).  KeyRotation.broadcast notifies known peers.
 * Your peer address changes — share the new one via /me.
 */
async function rotateIdentity(_args, { agent, t }) {
  if (!agent || typeof agent.rotateChatIdentity !== 'function') {
    return { ok: false, error: t('rotate.unavailable') };
  }
  try {
    const result = await agent.rotateChatIdentity();
    return {
      message: t('rotate.done', {
        oldPub:   result.oldPubKey.slice(0, 16) + '…',
        newPub:   result.newPubKey.slice(0, 16) + '…',
        grace:    result.graceUntilDays,
      }),
    };
  } catch (err) {
    return { ok: false, error: t('rotate.failed', { error: err.message ?? String(err) }) };
  }
}

/**
 * `/security-status` — v0.7.P3d.  Diagnostic for the crypto layer.
 */
async function securityStatus(_args, { agent, t }) {
  if (!agent || typeof agent.securityStatus !== 'function') {
    return { message: t('security.unavailable') };
  }
  const st = agent.securityStatus();
  const lines = ['Crypto state:'];
  lines.push(`  SecurityLayer wired:    ${st.layerWired ? 'yes' : 'no'}`);
  lines.push(`  Identity pubKey:        ${st.identityPub}`);
  lines.push(`  Identity stableId:      ${st.identityStable}`);
  lines.push(`  Peer transport status:  ${st.peerTransportConnected ? 'connected' : 'idle'}`);
  lines.push(`  Known peers (HI'd):     ${st.helloedPeerCount}`);
  // Factory-wired (S1+) extras — only shown when the relevant opt is on
  if (typeof st.muteCount === 'number') {
    lines.push(`  Muted peers:            ${st.muteCount}${st.muteIsPersistent ? ' (persistent)' : ' (in-memory)'}`);
  }
  if (st.helloGateWired) lines.push(`  helloGate:              wired`);
  if (st.claimWebidBound) lines.push(`  WebID claim bound:      ${st.claimWebidBound}`);
  if (st.vaultEncrypted)  lines.push(`  Vault encrypted:        yes (IndexedDB+AES-GCM)`);
  if (st.passkeyConfigured) {
    lines.push(`  Passkey unlock:         ${st.passkeyAvailable ? 'configured + available' : 'configured (WebAuthn unavailable)'}`);
  }
  if (st.resolverWired) lines.push(`  Identity resolver:      wired (alias-aware mute)`);
  if (st.trustWired)    lines.push(`  TrustRegistry:          wired`);
  if (st.capsWired)     lines.push(`  Capability tokens:      wired`);
  if (st.policyWired)   lines.push(`  PolicyEngine:           wired`);
  if (st.auditWired)    lines.push(`  Audit log:              ${st.auditSize} entries${st.auditAutoLog ? ' (autoLog on)' : ''}`);
  if (st.groupsWired)   lines.push(`  GroupManager:           wired`);
  if (st.rateLimitWired) lines.push(`  Rate limit:             wired`);
  if (st.pfsWired)      lines.push(`  PFS:                    partial (symmetric ratchet; no DH ratchet)`);
  if (st.helloedPeerCount > 0) {
    lines.push('');
    lines.push('Peers you can encrypt to:');
    for (const p of st.helloedPeers) {
      lines.push(`  - ${p.length > 64 ? p.slice(0, 60) + '…' : p}`);
    }
  }
  lines.push('');
  lines.push('Every OW envelope to a HI\'d peer is:');
  lines.push('  ✓ Ed25519-signed (sender authenticated)');
  lines.push('  ✓ nacl.box-encrypted (XSalsa20-Poly1305 + Curve25519 DH)');
  lines.push('  ✓ replay-protected (±10 min window + dedup cache)');
  return { message: lines.join('\n') };
}

/**
 * `/block <peer>` — add peer to the block set.  Resolver fanout
 * means a webid block stops the peer across all their devices /
 * addresses.  Persisted via the factory's muteListVaultKey opt.
 * (Internally the mechanism is `sa.mute`/op id `mute`; the user-facing
 * command + copy were renamed `/mute`→`/block` to free `/mute` for
 * stoop's local hide-only mute. See manifest.js.)
 */
async function muteHandler(args, { agent, t }) {
  const peer = String(args?.peer ?? args?._match ?? '').trim();
  if (!peer) return { ok: false, error: t('mute.no_peer') };
  const sa = agent?.sa;
  if (!sa?.mute) return { ok: false, error: t('mute.unavailable') };
  const added = await sa.mute.add(peer);
  if (!added) return { ok: true, message: t('mute.already', { peer }) };
  return { ok: true, message: t('mute.added', { peer }) };
}

/**
 * `/unblock <peer>` — remove a peer from the block set.
 */
async function unmuteHandler(args, { agent, t }) {
  const peer = String(args?.peer ?? args?._match ?? '').trim();
  if (!peer) return { ok: false, error: t('mute.no_peer') };
  const sa = agent?.sa;
  if (!sa?.mute) return { ok: false, error: t('mute.unavailable') };
  const removed = await sa.mute.remove(peer);
  if (!removed) return { ok: true, message: t('mute.not_muted', { peer }) };
  return { ok: true, message: t('mute.removed', { peer }) };
}

/**
 * `/blocked` — list current block set.
 */
async function mutedHandler(_args, { agent, t }) {
  const sa = agent?.sa;
  if (!sa?.mute) return { ok: false, error: t('mute.unavailable') };
  const list = sa.mute.list();
  if (list.length === 0) return { message: t('mute.empty') };
  const lines = [`Muted peers (${list.length}):`];
  for (const p of list) {
    lines.push(`  - ${p.length > 64 ? p.slice(0, 60) + '…' : p}`);
  }
  return { message: lines.join('\n') };
}

/**
 * `/audit-tail [n] [event=...]` — show the last N entries from the
 * signed audit chain.  Verifies the chain on every call.
 */
async function auditTailHandler(args, { agent, t }) {
  const sa = agent?.sa;
  if (!sa?.audit) return { ok: false, error: t('audit.unavailable') };
  const verification = sa.audit.verify();
  const n = Number.isInteger(args?.n) && args.n > 0 ? args.n : 20;
  const all = (typeof args?.event === 'string' && args.event)
    ? sa.audit.filter(args.event)
    : sa.audit.entries();
  const tail = all.slice(-n);
  const lines = [];
  lines.push(`Audit chain — ${all.length} total, ${tail.length} shown` +
             (verification.ok
                ? ' [chain verified]'
                : ` [⚠ chain BROKEN at index ${verification.brokenAt}: ${verification.reason}]`));
  if (tail.length === 0) return { message: lines.join('\n') };
  lines.push('');
  for (const e of tail) {
    const when = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19);
    const subj = e.subject ? ` ${e.subject.length > 50 ? e.subject.slice(0, 47) + '…' : e.subject}` : '';
    lines.push(`  ${when}  ${e.event}${subj}`);
  }
  return { message: lines.join('\n') };
}

/**
 * `/debug-dump` — v0.7.cc.  Triage snapshot to paste into a bug
 * report.  Includes everything Claude needs to diagnose a
 * cross-peer / safety / file-share issue WITHOUT a 12-round
 * "what does securityStatus say" interrogation.
 */
async function debugDump({ agent, t }) {
  if (!agent?.sa) return { ok: false, error: t('debug.unavailable') };
  const sa = agent.sa;
  const st = sa.securityStatus();
  const recent = (typeof sa.recentTraffic === 'function') ? sa.recentTraffic() : [];

  const lines = ['🩺 basis debug-dump'];
  lines.push('');
  lines.push('Identity');
  lines.push(`  pubKey:    ${st.identityPub}`);
  lines.push(`  stableId:  ${st.identityStable}`);
  lines.push('');
  lines.push('Peer');
  lines.push(`  transport: ${st.peerTransportConnected ? 'connected' : 'idle'}`);
  if (st.peerAddress) lines.push(`  address:   ${st.peerAddress}`);
  lines.push(`  HI'd peers: ${st.helloedPeerCount}`);
  lines.push('');
  lines.push('Safety');
  lines.push(`  SecurityLayer: ${st.layerWired ? 'on' : 'off'}`);
  lines.push(`  Muted:         ${st.muteCount ?? 0}${st.muteIsPersistent ? ' (persistent)' : ''}`);
  lines.push(`  Audit chain:   ${st.auditSize ?? 0} entries${st.auditAutoLog ? ' (autoLog on)' : ''}`);
  if (st.helloGateWired)   lines.push('  helloGate:     wired');
  if (st.claimWebidBound)  lines.push(`  Claim WebID:   ${st.claimWebidBound}`);
  if (st.vaultEncrypted)   lines.push('  Vault:         encrypted (IndexedDB+AES-GCM)');
  if (st.passkeyConfigured) lines.push(`  Passkey:       configured${st.passkeyAvailable ? ' + available' : ''}`);
  if (st.resolverWired)    lines.push('  Resolver:      wired');
  if (st.trustWired)       lines.push('  TrustRegistry: wired');
  if (st.capsWired)        lines.push('  Caps:          wired');
  if (st.policyWired)      lines.push('  PolicyEngine:  wired');
  if (st.groupsWired)      lines.push('  Groups:        wired');
  if (st.rateLimitWired)   lines.push('  Rate limit:    wired');
  if (st.pfsWired)         lines.push('  PFS:           partial (no DH ratchet)');
  lines.push('');
  if (recent.length === 0) {
    lines.push('No peer traffic recorded yet (recent buffer empty).');
  } else {
    lines.push(`Last ${recent.length} envelopes (most-recent last)`);
    for (const r of recent) {
      const when = new Date(r.ts).toISOString().slice(11, 19);
      const peer = r.dir === 'send'
        ? `→ ${(r.to ?? '').slice(0, 16)}…`
        : `← ${(r.from ?? '').slice(0, 16)}…`;
      const sub = r.subtype ?? '(no subtype)';
      lines.push(`  ${when}  ${r.dir}  ${peer}  ${sub}  ${r.size}B`);
    }
  }
  lines.push('');
  lines.push('(Paste this into the bug report.)');
  return { message: lines.join('\n') };
}

/**
 * `/help-with <post-id>` — v0.7.cc.  Open (or activate) a thread
 * filtered on a stoop post.  Mirrors stoop's "Ik help" UX.  Pure
 * chat-shell: no stoop-side skill needed; filter targets the post
 * via itemRef.id so any future event referencing that post lands
 * in this thread.
 */
async function helpWithPost(args, { threadStore, setActive, t }) {
  const postId = String(args?.postId ?? args?._match ?? '').trim();
  if (!postId) return { ok: false, error: t('helpWith.no_post') };
  if (!threadStore) return { ok: false, error: t('helpWith.no_store') };
  const id = `help-${postId}`;
  let thread = threadStore.getThread?.(id);
  if (!thread) {
    // Filter is wildcard (any event admitted) but the thread carries
    // the post id in its meta so the renderer can label + the stale-
    // panel logic (events.js: scan threads referencing an itemRef)
    // can surface item-changed events that mention this post.
    thread = threadStore.createThread({
      id,
      name: `Help with ${postId}`,
      meta: { postRef: { app: 'stoop', type: 'post', id: postId } },
      permissions: { allowCommands: true },
    });
  }
  if (typeof setActive === 'function') setActive(id);
  return {
    message: t('helpWith.opened', { postId, threadId: id }),
    threadId: id,
    postId,
  };
}

/**
 * `/peer-connect` — v0.7.P3b.  Initiates the NKN transport.
 */
async function peerConnect(_args, { connectPeer, t }) {
  if (typeof connectPeer !== 'function') return { ok: false, error: t('peer.unavailable') };
  try {
    const status = await connectPeer();
    return { message: t('peer.connected', { address: status.address }) };
  } catch (err) {
    return { ok: false, error: t('peer.connect_failed', { error: err.message ?? String(err) }) };
  }
}

/**
 * `/test-peer <addr> [text]` — v0.7.P3b.  Send a test envelope.
 *
 * 2026-05-27 slash audit close-out — the manifest param is `addr`
 * (matches the user-facing locale contract `peer.no_address` which
 * says `<addr>`).  Accept the legacy `address` arg name for back-compat
 * with any external caller that still passes the old key.
 */
async function testPeer(args, { agent, t }) {
  const address = String(args?.addr ?? args?.address ?? '').trim();
  const text    = String(args?.text ?? 'hello').trim();
  if (!address) return { ok: false, error: t('peer.no_address') };
  if (typeof agent?.sendPeerMessage !== 'function') {
    return { ok: false, error: t('peer.unavailable') };
  }
  if (agent.peer?.status !== 'connected') {
    return { ok: false, error: t('peer.not_connected') };
  }
  try {
    await agent.sendPeerMessage(address, {
      type:    'p2p-chat',
      subtype: 'chat-message',
      body:    text,
      sentAt:  Date.now(),
    });
    return { message: t('peer.sent', { address, text }) };
  } catch (err) {
    return { ok: false, error: t('peer.send_failed', { error: err.message ?? String(err) }) };
  }
}

/**
 * `/signout` — v0.7.. Clears the local OIDC session. v0.7.:
 * also unwires the calendar pod writer so subsequent mutations
 * stop writing-through to the (now-disconnected) pod.
 */
async function signOutFlow(_args, { podAuth, t, onSignOut }) {
  if (!podAuth || typeof podAuth.signOut !== 'function') {
    return { ok: false, error: t('signout.unavailable') };
  }
  try {
    await podAuth.signOut({});
    if (typeof onSignOut === 'function') {
      try { onSignOut(); } catch { /* defensive */ }
    }
    return { ok: true, message: t('signout.done') };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * `/apps [on|off] [name]` — v0.6 OQ-4.B chat-inline app-toggle.
 * Bare call lists apps + enabled state.  With action+name, toggles
 * and reports.
 */
async function appsToggle(args, { catalog, appRegistry, t }) {
  if (!appRegistry) return { ok: false, error: t('apps.no_registry') };

  // Positional binding: '/apps off stoop' parses to args._match='off stoop'
  // because flags-body packs positionals into _match for the router's
  // single-required-param binding.  Multi-positional commands like
  // /apps need to unpack manually.  Same pattern applies to any
  // 2+ positional flags-body op (user-reported 2026-05-23).
  const tokens = String(args?._match ?? '').trim().split(/\s+/).filter(Boolean);
  const action = args?.action ?? tokens[0];
  const name   = args?.app    ?? tokens[1];

  if (!action) {
    // List mode.
    const lines = [t('apps.heading')];
    const origins = catalog?.appOrigins ?? [];
    for (const origin of origins) {
      const on = appRegistry.isEnabled(origin) ? '●' : '○';
      lines.push(`  ${on} ${origin}`);
    }
    if (origins.length === 0) lines.push(`  ${t('apps.empty')}`);
    return { message: lines.join('\n') };
  }

  if (!name) {
    return { ok: false, error: t('apps.no_name', { action }) };
  }

  if (action === 'on' || action === 'off') {
    appRegistry.setEnabled(name, action === 'on');
    return {
      ok: true,
      message: action === 'on'
        ? t('apps.enabled',  { app: name })
        : t('apps.disabled', { app: name }),
    };
  }
  return { ok: false, error: t('apps.unknown_action', { action }) };
}

/**
 * `/send-to <peer> <itemId>` — v0.5.6 simulated cross-peer demo.
 *
 * Resolves the peer's destination thread from simPeers, builds an
 * embed against the catalog's factory (same path as /embed),
 * then appends a synthesised embed-card shell message DIRECTLY to
 * the peer's thread.  Returns a text confirmation in the sender's
 * active thread.
 *
 * This fakes the round-trip in a single browser tab.  Real cross-
 * peer delivery rides on the hosting app's chat surface (per v0.5.3).
 */
async function sendToPeer(args, { catalog, callSkill, t, localActor, simPeers, threadStore }) {
  const peer   = String(args?.peer ?? '').trim();
  const itemId = String(args?.itemId ?? '').trim();
  if (!peer)   return { ok: false, error: t('sendto.no_peer') };
  if (!itemId) return { ok: false, error: t('sendto.no_id') };
  if (!simPeers || !simPeers[peer]) {
    return { ok: false, error: t('sendto.unknown_peer', { peer }) };
  }
  const target = simPeers[peer];
  const destThread = threadStore?.getThread(target.threadId);
  if (!destThread) {
    return { ok: false, error: t('sendto.no_thread', { threadId: target.threadId }) };
  }

  // Use the same factory-discovery as /embed but make the recipient
  // perspective explicit — the embed's issuedBy is the local user;
  // the destination thread renders the [Claim] button because the
  // recipient (peer) is NOT the issuer.
  let snapshotSkill = null, snapshotAppOrigin = null;
  for (const [opId] of catalog.opsById) {
    const decl = catalog.embedSnapshotFor?.(opId);
    if (decl) { snapshotSkill = decl.snapshotSkill; snapshotAppOrigin = decl.appOrigin; break; }
  }
  if (!snapshotSkill) return { ok: false, error: t('embed.no_factory') };

  let snapshot;
  try {
    snapshot = await callSkill(snapshotAppOrigin, snapshotSkill, { choreId: itemId });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (!snapshot || snapshot.ok === false) {
    return { ok: false, error: snapshot?.error ?? 'snapshot failed' };
  }

  const embed = buildEmbed({
    appOrigin: snapshotAppOrigin,
    snapshot,
    issuedBy:  localActor ?? 'webid:local-demo-user',
  });

  // Synthesise an embed-card RenderedReply directly into the peer's
  // thread.  Bypasses the dispatch pipeline — this is the cross-peer
  // simulation path.
  destThread.addShellMessage({
    kind:           'embed-card',
    messageId:      `embed-from-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    threadId:       target.threadId,
    lifecycleState: 'live',
    embed,
  });

  return {
    ok:      true,
    message: t('sendto.sent', { peer, item: snapshot.title ?? itemId }),
  };
}

/**
 * `/embed-file` — v0.7.13.  Three modes:
 *   path=<existing> → look up via folio's getFileSnapshot;
 *                        embed real file metadata
 *   --pick             → opens browser File API picker; user
 *                        selects local file; reads bytes inline
 *   --name=X [...]     → synthesises (back-compat with v0.7.x)
 *
 * --share=<peer> routes to peer's thread.
 *
 * Media (2026-07): in --pick mode a picked IMAGE upgrades to the
 * sealed blob-gateway path (media-card + `{type:'media', ref}` pointer)
 * when the composition injects `mediaGateway`; see handlers/mediaEmbed.js.
 */
async function createFileEmbed(args, {
  localActor, t, simPeers, threadStore, callSkill, openFilePicker,
  mediaGateway, encodeImage, storeMediaItem,
}) {
  const path     = String(args?.path ?? '').trim();
  const name     = String(args?.name ?? '').trim();
  const share    = String(args?.share ?? '').trim();
  const issuer   = localActor ?? 'webid:local-demo-user';
  // v0.7.-fix 2026-05-23: bare `/embed-file` (no args) is the
  // friendliest case — auto-open the file picker.  Explicit
  // `--pick=false` or other flags disable the auto-pick.
  const explicitPickFlag = args && Object.prototype.hasOwnProperty.call(args, 'pick');
  const pick = explicitPickFlag
    ? !!args.pick
    : (!path && !name);

  let snapshot = null;
  let mediaEmbed = null;   // media — set when a picked image takes the sealed blob-gateway path

  // Mode 1: --path → folio lookup via.
  if (path && !pick) {
    if (typeof callSkill === 'function') {
      try {
        const r = await callSkill('folio', 'getFileSnapshot', { path });
        if (r && r.ok !== false && r.id) snapshot = r;
      } catch { /* fall through to synthesis */ }
    }
  }

  // Mode 2: --pick → browser File API.
  if (!snapshot && pick) {
    if (typeof openFilePicker !== 'function') {
      return { ok: false, error: t('embed-file.pick_unavailable') };
    }
    try {
      const file = await openFilePicker();
      if (!file) return { ok: false, error: t('embed-file.pick_cancelled') };
      const mime = file.type || file.mime || mimeFromExtension(file.name);
      // Media UPGRADE (not a fork): a picked IMAGE takes the sealed
      // blob-gateway path when the composition injected the gateway seams —
      // sealed upload + canonical `media` item + `{type:'media', ref}`
      // pointer (see handlers/mediaEmbed.js). Non-images, or a build
      // without the seams, keep the legacy inline file-card below.
      if (isImageMime(mime) && hasMediaGateway(mediaGateway)) {
        const m = await createMediaEmbed(args, {
          file, mediaGateway, encodeImage, storeMediaItem, localActor, t,
        });
        if (m?.ok === false) return m;
        mediaEmbed = m;
      } else {
        // Read file as base64 (inline) so the embed can travel.  For
        // larger files (> ~1MB) a real implementation would pod-upload
        // first + embed a pod URI.  Defer the threshold to v0.7.14.
        const dataB64 = await readFileAsBase64(file);
        snapshot = {
          id:    `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type:  'file',
          name:  file.name,
          mime,
          bytes: file.size,
          dataB64,
          local: true,
        };
      }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  // Mode 3 / fallback: synthesise from --name.
  if (!snapshot && !mediaEmbed) {
    if (!name && !path) return { ok: false, error: t('embed-file.no_input') };
    const finalName = name || (path.split('/').pop() ?? 'file');
    const mime = String(args?.mime ?? '').trim() || mimeFromExtension(finalName);
    const id   = path || `file-${Math.random().toString(36).slice(2, 8)}`;
    snapshot = {
      id, type: 'file', name: finalName, mime,
      bytes: Math.floor(Math.random() * 1024 * 1024 * 4),
      ...(path ? { path } : {}),
    };
  }

  const embed = mediaEmbed ?? {
    kind:      'file-card',
    appOrigin: 'folio',
    itemRef:   { app: 'folio', type: 'file', id: snapshot.id },
    snapshot,
    issuedBy:  issuer,
  };

  if (share) {
    const peer = simPeers?.[share];
    if (!peer) return { ok: false, error: t('sendto.unknown_peer', { peer: share }) };
    const destThread = threadStore?.getThread(peer.threadId);
    if (!destThread) return { ok: false, error: t('sendto.no_thread', { threadId: peer.threadId }) };
    destThread.addShellMessage({
      kind:           'embed-card',
      messageId:      `embed-from-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      threadId:       peer.threadId,
      lifecycleState: 'live',
      embed,
    });
    const itemLabel = mediaEmbed ? (embed.snapshot?.caption || embed.snapshot?.mime || 'media') : snapshot.name;
    return { ok: true, message: t('sendto.sent', { peer: share, item: itemLabel }) };
  }
  return embed;
}

/**
 * Read a browser File as base64 (data URL minus the prefix).
 * Pure browser-only via FileReader.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsBase64(file) {
  // RN/Hermes short-circuit: when the caller's openFilePicker
  // already returned bytes inline (expo-document-picker reads the URI
  // through expo-file-system before resolving), skip the browser
  // FileReader path — Hermes has neither FileReader nor a fetchable
  // URI we could re-read here.  Web's <input type="file"> path
  // returns a real File without `.dataB64`, so the original path
  // still fires there.
  if (typeof file?.dataB64 === 'string') return Promise.resolve(file.dataB64);
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader not available in this runtime'));
      return;
    }
    const fr = new FileReader();
    fr.onload  = () => {
      const dataUrl = String(fr.result ?? '');
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx > 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
    fr.readAsDataURL(file);
  });
}

function mimeFromExtension(name) {
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.pdf'))  return 'application/pdf';
  if (lower.endsWith('.png'))  return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.md'))   return 'text/markdown';
  if (lower.endsWith('.txt'))  return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/**
 * `/embed-time` — v0.7 catch-up.  Appointment maker (user F:
 * "calendar lookup as an appointment maker").  Until a real calendar
 * app exists, /embed-time CREATES an event card from the supplied
 * title + when + duration + location, optionally shared.
 *
 * `when` is parsed via the slack-style parseRelativeDate (OQ-3.A:
 * ISO + 'tomorrow' / 'next tuesday 3pm' / etc).
 * `duration` accepts '1h', '30m', '2h30m', '1d'; default 1h.
 *
 * Future: real calendar app + lookup-vs-create branch.
 */
async function createTimeEmbed(args, { localActor, t, simPeers, threadStore, callSkill }) {
  const title = String(args?.title ?? '').trim();
  const when  = String(args?.when  ?? '').trim();
  if (!title) return { ok: false, error: t('embed-time.no_title') };
  if (!when)  return { ok: false, error: t('embed-time.no_when') };

  // fall back to chrono-node for natural
  // language dates ("tomorrow 3pm", "next Friday").  parseDate is
  // already in the bundle (used by form elicitation) + benefits
  // both web and mobile surfaces.
  let startAt;
  const direct = new Date(when);
  if (!Number.isNaN(direct.getTime())) {
    startAt = direct;
  } else {
    const chronoIso = await parseDateLazy(when);
    const chronoDate = chronoIso ? new Date(chronoIso) : null;
    if (chronoDate && !Number.isNaN(chronoDate.getTime())) {
      startAt = chronoDate;
    } else {
      return { ok: false, error: t('embed-time.bad_when', { when }) };
    }
  }
  const durationMs = parseDuration(String(args?.duration ?? '').trim()) ?? 3_600_000;
  const endAt = new Date(startAt.getTime() + durationMs);
  const location = String(args?.location ?? '').trim() || undefined;
  const share    = String(args?.share    ?? '').trim();
  const issuer   = localActor ?? 'webid:local-demo-user';

  // v0.7.10 — dispatch to the calendar app's real addEvent skill.
  // The calendar app persists the event to its store; we then build
  // the embed envelope from the persisted snapshot.
  let event;
  if (typeof callSkill === 'function') {
    try {
      const reply = await callSkill('calendar', 'addEvent', {
        title,
        startsAt: startAt.toISOString(),
        endsAt:   endAt.toISOString(),
        ...(location ? { location } : {}),
        attendees: share ? [share] : [],
        actor:     issuer,
      });
      if (reply?.ok === false) return reply;   // pass through error
      // Read back the snapshot for the embed.
      event = reply?.itemId
        ? await callSkill('calendar', 'getEventSnapshot', { id: reply.itemId })
        : null;
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  // Fall back to synthesized snapshot if calendar dispatch unavailable
  // (defensive — shouldn't happen in the v0.7.10 demo).
  if (!event || event.ok === false) {
    const id = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    event = {
      id, type: 'time', title,
      startAt:  startAt.toISOString(),
      endAt:    endAt.toISOString(),
      ...(location ? { location } : {}),
    };
  }

  const embed = {
    kind:      'time-card',
    appOrigin: 'calendar',
    itemRef:   { app: 'calendar', type: 'calendar-event', id: event.id },
    snapshot: {
      id:    event.id,
      type:  event.type ?? 'calendar-event',
      title: event.title,
      startAt:  event.startAt  ?? event.startsAt,
      endAt:    event.endAt    ?? event.endsAt,
      timezone: 'UTC',
      ...(event.location ? { location: event.location } : {}),
      ...(event.fields   ? { fields:   event.fields   } : {}),
    },
    issuedBy: issuer,
  };

  if (share) {
    const peer = simPeers?.[share];
    if (!peer) return { ok: false, error: t('sendto.unknown_peer', { peer: share }) };
    const destThread = threadStore?.getThread(peer.threadId);
    if (!destThread) return { ok: false, error: t('sendto.no_thread', { threadId: peer.threadId }) };
    destThread.addShellMessage({
      kind:           'embed-card',
      messageId:      `embed-from-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      threadId:       peer.threadId,
      lifecycleState: 'live',
      embed,
    });
    return { ok: true, message: t('sendto.sent', { peer: share, item: title }) };
  }
  return embed;
}

/** Parse '1h' / '30m' / '2h30m' / '1d' / '90m' into ms.  Returns null on parse fail. */
function parseDuration(text) {
  if (!text) return null;
  let total = 0;
  const re = /(\d+)\s*([dhm])/g;
  let m, matched = false;
  while ((m = re.exec(text)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    if (m[2] === 'd') total += n * 86_400_000;
    if (m[2] === 'h') total += n *  3_600_000;
    if (m[2] === 'm') total += n *     60_000;
  }
  return matched ? total : null;
}

/**
 * `/embed <itemId>` — scan the merged catalog for ops that declare
 * a cardSnapshotSkill, fetch a snapshot, and return an embed
 * card reply.
 *
 * v0.5.1 — supports `--claim` flag for sender-claim-on-behalf:
 *   /embed c-1                  → issued; receiver claims
 *   /embed c-1 --claim          → issued AND claimed by sender
 *                                  ("I'll handle this")
 *
 * Cross-peer P2P delivery rides on each app's existing chat surface
 * (e.g. stoop's sendChatMessage) — basis produces the
 * envelope; the source app delivers.  Not in basis's scope
 * to compose @onderling/chat-p2p directly (per v0.5.3 audit).
 */
async function createEmbed(args, { catalog, callSkill, t, localActor }) {
  // Parse args — supports both flag-style (--claim) and bare itemId.
  // The router's flag parser already split these for `/embed`; if
  // the user typed `/embed c-1 --claim`, args.itemId='c-1' and
  // args.claim=true.
  const itemId = String(args?.itemId ?? '').trim();
  const claimOnBehalf = !!args?.claim;
  if (!itemId) {
    return { ok: false, error: t('embed.no_id') };
  }
  if (typeof callSkill !== 'function') {
    return { ok: false, error: t('embed.no_callskill') };
  }

  let snapshotSkill = null;
  let snapshotAppOrigin = null;
  for (const [opId, entry] of catalog.opsById) {
    const decl = catalog.embedSnapshotFor?.(opId);
    if (decl) {
      snapshotSkill     = decl.snapshotSkill;
      snapshotAppOrigin = decl.appOrigin;
      break;
    }
  }
  if (!snapshotSkill) {
    return { ok: false, error: t('embed.no_factory') };
  }

  try {
    const snapshot = await callSkill(snapshotAppOrigin, snapshotSkill, { choreId: itemId });
    if (!snapshot || snapshot.ok === false) {
      return { ok: false, error: snapshot?.error ?? 'snapshot failed' };
    }
    const issuer = localActor ?? 'webid:local-demo-user';
    let embed = buildEmbed({
      appOrigin: snapshotAppOrigin,
      snapshot,
      issuedBy:  issuer,
    });
    if (claimOnBehalf) {
      // Sender claims-on-behalf — the receiver sees the embed
      // already claimed by the sender; can still react but knows
      // the issuer's already on it.
      embed = { ...embed, claimedBy: issuer, claimedAt: Date.now() };
    }
    return embed;
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * `/newthread <name>` — create + switch.
 *
 * @param {{name: string}} args
 */
function createNewThread(args, { threadStore, setActive, t }) {
  if (!threadStore) {
    return { ok: false, error: t('newthread.no_store') };
  }
  const name = String(args?.name ?? '').trim();
  if (!name) {
    return { ok: false, error: t('newthread.no_name') };
  }
  const thread = threadStore.createThread({
    name,
    filter:      {},   // wildcard — user can refine via sidebar later
    permissions: { allowCommands: true },
  });
  if (typeof setActive === 'function') setActive(thread.id);
  return {
    ok: true,
    message: t('newthread.created', { name: thread.name }),
    threadId: thread.id,
  };
}

/**
 * `/dm <webid>` — open (or activate) a DM thread paired
 * with the given peer.  Mirrors main.js's ensureDmThread; lives in
 * localBuiltins so the slash dispatch path is symmetric with the
 * button-click intercept.
 */
function createDmThread(args, { threadStore, setActive, t }) {
  if (!threadStore) {
    return { ok: false, error: t('newthread.no_store', { defaultValue: 'Thread store unavailable.' }) };
  }
  const peerId = String(args?.webid ?? args?.id ?? '').trim();
  if (!peerId) {
    return { ok: false, error: 'Pass a webid or peer address: /dm <peerId>' };
  }
  // Look for an existing DM with this peer; activate it if found.
  const existing = [...threadStore.listThreads()].find(th =>
    th.filter?.dm === true
      && Array.isArray(th.filter?.actors)
      && th.filter.actors.includes(peerId),
  );
  if (existing) {
    if (typeof setActive === 'function') setActive(existing.id);
    return { ok: true, message: `Opened DM with ${peerId.slice(0, 16)}…`, threadId: existing.id };
  }
  const thread = threadStore.createThread({
    name:   `DM: ${peerId.slice(0, 16)}…`,
    filter: { actors: [peerId], dm: true },
    permissions: { allowCommands: true },
  });
  if (typeof setActive === 'function') setActive(thread.id);
  return { ok: true, message: `Started DM with ${peerId.slice(0, 16)}…`, threadId: thread.id };
}

/**
 * `/threads` — list all threads with their filters.
 */
function listThreads({ threadStore, t }) {
  if (!threadStore) {
    return { message: t('threads.no_store') };
  }
  const all = threadStore.listThreads();
  if (all.length === 0) {
    return { message: t('threads.empty') };
  }
  const lines = [t('threads.heading')];
  for (const th of all) {
    const filt    = describeFilter(th.filter);
    const filtStr = filt === '*' ? '' : ` (${filt})`;
    const active  = th.id === threadStore.activeId ? ' ●' : '';
    lines.push(`  ${th.name}${active}${filtStr}`);
  }
  return { message: lines.join('\n') };
}

/**
 * Render the `/help` reply as a single text payload.  Groups
 * commands by appOrigin so the user can see at a glance which app
 * owns what.
 *
 * @param {import('../manifestMerge.js').MergedCatalog} catalog
 * @param {(key: string, params?: object) => string}   t
 * @returns {{ message: string }}
 */
function formatHelp(catalog, t) {
  const commands = catalog?.commandMenu ?? [];
  if (commands.length === 0) {
    return { message: t('help.empty') };
  }

  // Group by appOrigin.  Sort each group's commands alphabetically.
  /** @type {Map<string, Array<{command: string, opId: string, hint: string}>>} */
  const byOrigin = new Map();
  for (const entry of commands) {
    const op   = catalog.opsById?.get(entry.opId)?.op;
    const hint = op?.surfaces?.chat?.hint ?? op?.id ?? '';
    const arr  = byOrigin.get(entry.appOrigin) ?? [];
    arr.push({ command: entry.command, opId: entry.opId, hint });
    byOrigin.set(entry.appOrigin, arr);
  }
  for (const arr of byOrigin.values()) {
    arr.sort((a, b) => a.command.localeCompare(b.command));
  }

  // Render: app heading + per-command line.  basis's own
  // built-ins surface under "Chat" not the app name.
  const lines = [t('help.heading')];
  // Stable origin order: basis (chat-shell built-ins) first,
  // then alphabetical.
  const origins = [...byOrigin.keys()].sort((a, b) => {
    if (a === 'basis') return -1;
    if (b === 'basis') return  1;
    return a.localeCompare(b);
  });
  for (const origin of origins) {
    const label = origin === 'basis'
      ? t('help.section_chat')
      : t('help.section_app', { app: origin });
    lines.push('');
    lines.push(label);
    for (const { command, hint } of byOrigin.get(origin)) {
      lines.push(`  ${command}  —  ${hint}`);
    }
  }
  return { message: lines.join('\n') };
}

/* ─── A1 (2026-05-23) — relay-server slash handlers ─────────── */

const RELAY_VAULT_KEY    = 'cc-relay-url';
const TRANSPORT_VAULT_KEY = 'cc-transport-mode';

/**
 * `/set-relay <ws://...>` — persist + connect to a relay.
 * `/set-relay --clear`    — disconnect + clear the persisted URL.
 *
 * The agent's secure-agent has sa.relay.connect({relayUrl}) /
 * sa.relay.disconnect() exposed.  The slash both APPLIES the change
 * live AND persists to the vault so the next boot re-applies it.
 */
async function setRelay(args, { agent, t }) {
  if (!agent?.relay || !agent?.vault?.set) {
    return { ok: false, error: t('relay.no_substrate') };
  }
  if (args?.clear) {
    try { await agent.relay.disconnect(); } catch { /* swallow */ }
    try { await agent.vault.delete?.(RELAY_VAULT_KEY); }
    catch { await agent.vault.set(RELAY_VAULT_KEY, ''); }
    return { ok: true, message: t('relay.cleared') };
  }
  const url = String(args?.url ?? '').trim();
  if (!url) return { ok: false, error: t('relay.url_required') };
  if (!/^wss?:\/\//.test(url)) return { ok: false, error: t('relay.bad_url') };
  try {
    await agent.vault.set(RELAY_VAULT_KEY, url);
    if (agent.relay.status === 'connected') {
      try { await agent.relay.disconnect(); } catch { /* swallow */ }
    }
    await agent.relay.connect({ relayUrl: url });
    return {
      ok: true,
      message: t('relay.connected', { url, address: agent.relay.address }),
    };
  } catch (err) {
    return { ok: false, error: t('relay.connect_failed', { reason: err.message ?? String(err) }) };
  }
}

/**
 * `/transport-mode <nkn|relay|both>` — pick which transport handles
 * outbound peer sends.  Persists to vault; takes effect immediately.
 */
async function transportMode(args, { agent, t }) {
  if (typeof agent?.setTransportMode !== 'function' || !agent?.vault?.set) {
    return { ok: false, error: t('transport.no_substrate') };
  }
  const mode = String(args?.mode ?? '').trim();
  if (!['nkn', 'relay', 'both'].includes(mode)) {
    return { ok: false, error: t('transport.bad_mode', { mode }) };
  }
  try {
    agent.setTransportMode(mode);
    await agent.vault.set(TRANSPORT_VAULT_KEY, mode);
    return { ok: true, message: t('transport.mode_set', { mode }) };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * `/transports` — record reply with NKN + relay status side-by-side.
 */
/**
 * settings page handler. Invoked TWO ways:
 *   1. Bare `/settings` opens the panel (dispatchAndRender intercepts
 *      and never calls this handler — the panel handles its own
 *      submit).
 *   2. /settings --lang=nl  — the panel's submit OR a typed slash
 *      with the lang flag triggers a real dispatch through this
 *      handler.  Applies the locale change live.
 */
async function settingsHandler(args, { t }) {
  const lang = String(args?.lang ?? '').trim();
  if (lang && (lang === 'en' || lang === 'nl')) {
    try {
      const i18n = await import('i18next');
      await i18n.default.changeLanguage(lang);
      return { ok: true, message: t('settings.changed', { lang }) ?? `✓ Language: ${lang}` };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }
  return { ok: true, message: t('settings.no_changes') ?? '(no changes)' };
}

async function transportsStatus({ agent, t }) {
  if (!agent) return { ok: false, error: t('transport.no_substrate') };
  return {
    title:       t('transport.status_title'),
    mode:        agent.transportMode ?? 'nkn',
    nknStatus:   agent.peer?.status  ?? 'idle',
    peerAddress:  agent.peer?.address ?? '(none)',
    relayStatus: agent.relay?.status ?? 'idle',
    relayUrl:    agent.relay?.url    ?? '(none)',
    relayError:  agent.relay?.error  ?? null,
  };
}
