#!/usr/bin/env node
/**
 * walk-peer — a HEADLESS second member you can drive by hand, for the on-device journey walks.
 *
 * The verification sessions need two real participants. Getting two phones onto one Wi-Fi is the
 * expensive part of S1; for S4 (infrastructure) the second participant does not need to be a phone at
 * all — it needs to be a real agent on a real relay that you can make do things while you watch the
 * phone. That is this.
 *
 * It is NOT a test harness: nothing here asserts. It boots the **same app agent the shells boot**
 * (`createRealHouseholdAgent` via the real-agent support module — stoop skills, circles, per-circle
 * addressing, circle-scoped routing) and gives you a prompt.
 *
 *   node apps/e2e-journeys/walk-peer.mjs                     # starts its own local relay
 *   node apps/e2e-journeys/walk-peer.mjs ws://192.168.1.20:8787   # join a relay your phone can reach
 *   node apps/e2e-journeys/walk-peer.mjs ws://… --handle=bram    # a SECOND peer in the same circle
 *   node apps/e2e-journeys/walk-peer.mjs ws://… --address-fallback=off   # refuse the global-key fallback
 *   node apps/e2e-journeys/walk-peer.mjs ws://… --machine        # one JSON result line per command
 *
 * The handle is a parameter because handles are unique per circle: two copies with the same one cannot
 * both join, so anything with THREE participants was impossible while it was a literal (found B3,
 * 2026-08-02). `--machine` exists for the same reason — a three-process scenario has to read results
 * back, and parsing prose is not reading. Flags may also be given as env vars (`WALK_PEER_HANDLE`,
 * `WALK_PEER_ADDRESS_FALLBACK`, `WALK_PEER_MACHINE`).
 *
 * The relay URL matters: your phone cannot reach `localhost`. Start the relay bound to your LAN address
 * (or use `deploy/tunnel`), and point BOTH the phone and this peer at the same URL — otherwise you are
 * walking two separate worlds and every journey "fails" for the wrong reason.
 *
 * Commands (type `help`):
 *   whoami                    my addresses — the pubKey, and my per-circle address for each circle
 *   circle <name>             create a circle, print the invite URI to paste/scan on the phone
 *   invite <circleId>         a fresh invite for an existing circle
 *   join <invite-uri>         join a circle the PHONE created
 *   post <circleId> <text>    send a circle message
 *   circles                   what I am in, and which connection point each rides
 *   members <circleId>        the roster as I see it — with each member's per-circle address
 *   offline / online          drop and restore my transport (for hold-forward journeys)
 *   log                       what I have received since the last `log`
 *
 * Why a prompt rather than a script: the journeys are about what a HUMAN observes, and the interesting
 * failures show up in the timing between two participants ("post, then watch the phone for 30s"). A
 * scripted run cannot pause where you need to look.
 */
import { createInterface } from 'node:readline';
import { startRelay } from '@onderling/relay';
import { bootRealAgentNode, sendCircleChat } from '../basis/test/support/pairRealAgents.js';
import { makeCircleReachable } from '../basis/src/v2/householdRosterPairing.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../basis/src/v2/circleInvite.js';
import { quickCreateCircle } from '../basis/src/v2/circleCreate.js';
// The two halves of what a shell does on connect and after every join (`registerCirclePresence` in
// web/v2/circleApp.js): prime each circle's security state, then register its address on the relay.
import { primeCircleSecurity } from '../basis/src/v2/circleSecurityPriming.js';
import { announceOwnCircleAddress } from '../basis/src/v2/circleAddressAnnounce.js';
import { registerCircleAddresses } from '../basis/src/v2/circleAddressRegistration.js';

const flags = new Map();
const positional = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags.set(k, v ?? 'true');
  } else positional.push(a);
}

const argUrl = positional[0] ?? process.env.RELAY_URL ?? null;
/** Unique PER CIRCLE — a second peer reusing it is refused `handle-taken`, so it cannot be a literal. */
const HANDLE = flags.get('handle') ?? process.env.WALK_PEER_HANDLE ?? 'walkpeer';
/** `off` = the private default: rather undeliverable than routed over my one global key. */
const ADDRESS_FALLBACK = (flags.get('address-fallback') ?? process.env.WALK_PEER_ADDRESS_FALLBACK ?? 'on') !== 'off';
/** One `##RESULT {json}` line per command, so a scenario script can read what happened. */
const MACHINE = flags.has('machine') || process.env.WALK_PEER_MACHINE === '1';

const emit = (obj) => { if (MACHINE) console.log(`##RESULT ${JSON.stringify(obj)}`); };

async function main() {
  let relayUrl = argUrl;
  let relay = null;
  if (!relayUrl) {
    relay = await startRelay({ port: 0 });
    relayUrl = `ws://127.0.0.1:${relay.port}`;
    console.log(`[walk-peer] started a local relay at ${relayUrl}`);
    console.log('[walk-peer] ⚠ a phone cannot reach 127.0.0.1 — pass a LAN url to share this relay:');
    console.log('[walk-peer]   node apps/e2e-journeys/walk-peer.mjs ws://<your-lan-ip>:<port>');
  }

  const me = await bootRealAgentNode(`walk-peer:${HANDLE}`, {
    redeemTimeoutMs: 45_000,
    // The per-user address-fallback setting, threaded into the production factory. With it ON every
    // send also works when per-circle addressing is broken — so a run that means to prove addressing
    // must be able to turn it off.
    agentOpts: { allowAddressFallback: ADDRESS_FALLBACK },
  });
  await me.agent.connectPeerTransport({
    relayUrl,
    // ONE argument: the router is `onPeerMessage(env)` and destructures `{from, payload}` off it. This site
        // used to spread it as `(addr, payload)`, so the router received an address STRING where it expected an
        // envelope, found no `payload.subtype`, and dropped every inbound message — which made `log` report
        // "(nothing received)" and looked exactly like the phone failing to deliver (2026-07-30). Every other
        // call site in `pairRealAgents.js` already passed `(env)`; only the walk harness diverged.
        onPeerMessage: (env) => me._routerRef.fn?.(env),
  });
  console.log(`[walk-peer] connected to ${relayUrl}`);
  console.log(`[walk-peer] handle: ${HANDLE}  address-fallback: ${ADDRESS_FALLBACK ? 'on' : 'OFF'}`);
  console.log(`[walk-peer] my pubKey: ${me.pubKey}`);
  console.log('[walk-peer] type `help` for commands.\n');
  emit({ event: 'ready', pubKey: me.pubKey, relayUrl, handle: HANDLE, addressFallback: ADDRESS_FALLBACK });

  const call = (app, op, args) => me.agent.callSkill(app, op, args);

  const commands = {
    async help() {
      console.log(`
  whoami                  my addresses (pubKey + per-circle)
  circle <name>           create a circle + print an invite
  invite <circleId>       a fresh invite for an existing circle
  join <invite-uri>       join a circle the phone created
  post <circleId> <text>  send a circle message
  circles                 circles I am in
  members <circleId>      roster as I see it (with per-circle addresses)
  announce <circleId>     re-prove my per-circle address to the circle
  auth                    what my membership check actually enforces
  offline | online        drop / restore my transport
  log                     messages received since the last log
  role <circleId> <webid> <admin|member>   promote someone, or step yourself back
  ack <circleId>          sign for a caretaker appointment that landed on me
  call <app> <op> [json]  any declared op, for a walk the harness has no verb for yet
  quit`);
    },

    async whoami() {
      console.log(`pubKey: ${me.pubKey}`);
      const { circles } = await listCircles();
      const out = [];
      for (const c of circles) {
        const addr = await me.agent.circleAddressFor?.(c.id);
        console.log(`  ${c.id}: ${addr ?? '(no per-circle address)'}`);
        out.push({ id: c.id, circleAddress: addr ?? null });
      }
      return { pubKey: me.pubKey, handle: HANDLE, circles: out };
    },

    async circle(...name) {
      const label = name.join(' ') || 'Walk circle';
      const r = await quickCreateCircle({ callSkill: call, name: label });
      if (!r?.groupId) { console.log('create failed:', JSON.stringify(r)); return { error: 'create-failed' }; }
      console.log(`created ${r.groupId}`);
      await registerCirclePresence([r.groupId]);
      const inv = await commands.invite(r.groupId);
      return { circleId: r.groupId, ...inv };
    },

    async invite(circleId) {
      if (!circleId) { console.log('usage: invite <circleId>'); return { error: 'usage' }; }
      const r = await buildCircleInviteUri({
        callSkill: call, circleId,
        adminPeerAddr: me.pubKey,
        relayUrl,
      });
      if (r?.error) { console.log('invite failed:', r.error); return { error: r.error }; }
      console.log('\n' + r.uri + '\n');
      console.log('(paste this into the phone\'s "join a circle", or render it as a QR)');
      return { circleId, uri: r.uri };
    },

    async join(uri) {
      if (!uri) { console.log('usage: join <invite-uri>'); return { error: 'usage' }; }
      const r = await joinCircleFromInvite({
        inviteUri: uri, callSkill: call, sendPeerRedeem: me.sendPeerRedeem, handle: HANDLE,
      });
      console.log(r?.ok ? `joined ${r.circleId}` : `join failed: ${JSON.stringify(r)}`);
      if (r?.ok) {
        // Exactly the shells' `onJoined` (circleApp.js): make the circle reachable — register this
        // device's address for it and bind every other member's — through the shared helper.
        await makeCircleReachable({
          agent: me.agent,
          circleId: r.circleId,
          registerCirclePresence: () => registerCirclePresence([r.circleId]),
        });
      }
      return { ok: !!r?.ok, circleId: r?.circleId ?? null, error: r?.ok ? undefined : (r?.error ?? r?.reason ?? JSON.stringify(r ?? null)) };
    },

    async post(circleId, ...rest) {
      const text = rest.join(' ');
      if (!circleId || !text) { console.log('usage: post <circleId> <text>'); return { error: 'usage' }; }
      // `msgId` is required by the skill — the shells mint one per message and key delivery state on it
      // (`broadcastCircleFanOut`). This tool did not, so `post` failed with `msgId-required` the first time
      // anyone tried to send from it (2026-07-30). Mirror what a shell does rather than inventing a shape.
      const msgId = `walk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      // The SIGNED statement path (rider 3b replaced the plain-envelope op): append the render
      // entry on this node's own rail, then fan the statement — the exact production shape.
      const r = await sendCircleChat(me, { groupId: circleId, msgId, text });
      console.log('sent:', JSON.stringify(r));
      // `sent` counts recipients the send path accepted — HELD counts as sent. If the phone does not
      // show it, that is the interesting part: check the relay log before assuming a UI bug.
      return { msgId, text, sent: r?.sent ?? 0, errors: r?.errors ?? [] };
    },

    async circles() {
      const { circles } = await listCircles();
      if (!circles.length) console.log('(none)');
      for (const c of circles) console.log(`  ${c.id}  ${c.name ?? ''}`);
      return { circles: circles.map((c) => ({ id: c.id, name: c.name ?? null })) };
    },

    /**
     * Promote a member, or step yourself back. The handover path — a step-down that would empty the
     * admin set hands the circle to whoever the fold appoints, and the appointee is told.
     */
    async role(circleId, memberWebid, role) {
      if (!circleId || !memberWebid || !role) {
        console.log('usage: role <circleId> <memberWebid> <admin|member>'); return { error: 'usage' };
      }
      const r = await call('stoop', 'setMemberRole', { groupId: circleId, memberWebid, role });
      console.log(r?.error ? `refused: ${r.error}` : `ok: ${memberWebid.slice(0, 12)}… is now ${role}`);
      return r ?? {};
    },

    /** Sign for a caretaker appointment — the circle can then see that I know it landed on me. */
    async ack(circleId) {
      if (!circleId) { console.log('usage: ack <circleId>'); return { error: 'usage' }; }
      const r = await call('stoop', 'acknowledgeCaretaker', { groupId: circleId });
      console.log(r?.ok ? `signed for ${r.seed?.slice(0, 12)}…` : `not signed: ${r?.reason}`);
      return r ?? {};
    },

    /**
     * The escape hatch. A walk should never stall because this harness lacks a verb — that is a gap in
     * the harness, not a finding about the product, and discovering it mid-walk costs a restart, which
     * costs the circle (everything here is in-memory).
     */
    async call(app, op, ...rest) {
      if (!app || !op) { console.log('usage: call <app> <op> [json]'); return { error: 'usage' }; }
      let args = {};
      const raw = rest.join(' ').trim();
      if (raw) { try { args = JSON.parse(raw); } catch { console.log('args must be JSON'); return { error: 'bad-json' }; } }
      const r = await call(app, op, args);
      console.log(JSON.stringify(r, null, 1)?.slice(0, 600));
      return { result: r ?? null };
    },

    async members(circleId) {
      if (!circleId) { console.log('usage: members <circleId>'); return { error: 'usage' }; }
      const r = await call('stoop', 'listGroupMembers', { groupId: circleId });
      for (const m of r?.members ?? []) {
        console.log(`  ${String(m.webid ?? '?').slice(0, 20)}…  pubKey=${String(m.pubKey ?? '-').slice(0, 12)}…  circleAddress=${m.circleAddress ?? '-'}`);
      }
      return {
        members: (r?.members ?? []).map((m) => ({
          webid: m.webid ?? null, pubKey: m.pubKey ?? null, handle: m.handle ?? null,
          circleAddress: m.circleAddress ?? null, hasProof: typeof m.circleAddressProof === 'string',
        })),
      };
    },

    async offline() {
      await me.agent.sa?.relay?.disconnect?.();
      console.log('offline — sends to me should now be HELD, not lost');
      return { online: false };
    },

    async online() {
      await me.agent.connectPeerTransport({
        relayUrl,
        // ONE argument: the router is `onPeerMessage(env)` and destructures `{from, payload}` off it. This site
        // used to spread it as `(addr, payload)`, so the router received an address STRING where it expected an
        // envelope, found no `payload.subtype`, and dropped every inbound message — which made `log` report
        // "(nothing received)" and looked exactly like the phone failing to deliver (2026-07-30). Every other
        // call site in `pairRealAgents.js` already passed `(env)`; only the walk harness diverged.
        onPeerMessage: (env) => me._routerRef.fn?.(env),
      });
      console.log('online — anything held for me should flush now');
      return { online: true };
    },

    async log() {
      const rows = me.chatEvents ?? [];
      if (!rows.length) console.log('(nothing received)');
      for (const e of rows) console.log(`  [${e.type}] ${e.payload?.text ?? JSON.stringify(e.payload ?? {}).slice(0, 80)}`);
      return { texts: rows.map((e) => e?.payload?.text ?? null).filter((t) => typeof t === 'string') };
    },

    /**
     * Re-prove my per-circle address to the circle — the "re-prove in place" operation.
     *
     * Unconditional, unlike the boot trigger (`announceOwnCircleAddressIfChanged`), because the point
     * of driving it by hand is to see what an announcement does when the roster already agrees.
     */
    async announce(circleId) {
      if (!circleId) { console.log('usage: announce <circleId>'); return { error: 'usage' }; }
      const r = await announceOwnCircleAddress({ agent: me.agent, circleId });
      console.log('announce:', JSON.stringify(r));
      return { announced: !!r?.announced, sent: r?.sent ?? 0, reached: !!r?.reached, reason: r?.reason };
    },

    /**
     * How strong this device's membership check actually is (the `/security-status` diagnostic).
     *
     * Worth its own command because a REFUSED envelope is silent: delivery failing and delivery being
     * rejected look identical from the sender, and `installed:false` / a zero circle count is the
     * difference between "authorized" and "nothing was checked".
     */
    async auth() {
      const status = me.agent.circleSenderAuthorization?.() ?? null;
      console.log(JSON.stringify(status));
      return { auth: status };
    },
  };

  /**
   * The harness mirror of the shells' `registerCirclePresence` (web/v2/circleApp.js, mobile agentBundle.js):
   * prime every circle's security state, then register this device's per-circle addresses on the relay.
   *
   * Found finishing the round-trip (2026-07-30). A roster row carries a member's per-circle address, so peers
   * send to it. The shells register their aliases with the relay; walk-peer never did, so it was reachable
   * only under its pubKey — it could send but not be sent to, which read exactly like the phone failing to
   * deliver.
   *
   * It then registered them WRONG (found B3, 2026-08-02): a bare `relay.addAddress(addr)` with no signer.
   * An address IS a key, and since Decision 3 the relay challenges every one of them, so the transport
   * refuses that call outright ("no signer for this address") — inside a try/catch that printed one line
   * nobody reads. Same class of bug as the two above, and the same fix: call what the app calls.
   * `primeCircleSecurity` is the other half — without `installCircleIdentities` this peer cannot OPEN
   * circle traffic addressed to it, and without the roster snapshot it accepts every sender unchecked.
   *
   * Unscoped on purpose: a walk peer rides one relay, so every circle rides it (the scoping rule — a circle
   * registers only on relays it uses — is the shells' concern, tested there).
   *
   * ORDER: prime, THEN register — deliberately, because that is mobile's order
   * (`basis-mobile/src/core/agentBundle.js` awaits `primeCircleSecurity` before `registerCircleAddresses`;
   * web fires both without awaiting between them, so it races). It matters: priming ANNOUNCES this
   * device's per-circle address, and until the alias below is bound the transport cannot send as it and
   * falls back to the primary (global) key — which the receiver then refuses, silently, as a member
   * signing canonically. Measured in the three-party run (2026-08-02): 2 downgrades per joiner, 4
   * refusals at the admin, and zero of either when the two calls are swapped. Keeping mobile's order
   * means the harness reproduces the hazard instead of hiding it.
   */
  async function registerCirclePresence(extraCircleIds = []) {
    const { circles } = await listCircles();
    const circleIds = [...new Set([...circles.map((c) => c.id), ...extraCircleIds])].filter(Boolean);
    if (!circleIds.length) return { circleIds: [], registered: [] };
    let primed = null;
    try {
      primed = await primeCircleSecurity({ agent: me.agent, circleIds, onWarn: (m, e) => console.log(`[walk-peer] ${m}: ${e?.message ?? e ?? ''}`) });
    } catch (err) {
      console.log('[walk-peer] circle security priming failed:', err?.message ?? err);
    }
    let out = { registered: [] };
    try {
      const transport = me.agent?.relay;
      if (transport?.supportsAliases) {
        out = await registerCircleAddresses({
          transport,
          relayUrl,
          circleIds,
          circleAddressFor: (cid) => me.agent?.circleAddressFor?.(cid) ?? null,
          // An address IS a key: registering it means answering the relay's challenge with the key
          // behind it (Decision 3). Omitting this is what made every alias refused, silently.
          circleAddressSignerFor: (cid) => me.agent?.circleAddressSignerFor?.(cid) ?? null,
          defaultRelayUrl: relayUrl,
          onError: (err, cid) => console.log(`[walk-peer] circle-address register failed (${cid}): ${err?.message ?? err}`),
        });
      }
    } catch (err) {
      console.log('[walk-peer] circle-address registration failed:', err?.message ?? err);
    }
    return { circleIds, primed, ...out };
  }

  async function listCircles() {
    try {
      // `listMyCircles` is what the shells use (circleSources.fetchGroups) — it returns EVERY circle the
      // actor is in, including one just created. `getCurrentGroup` only ever returned the active one.
      const r = await call('stoop', 'listMyCircles', {});
      const ids = Array.isArray(r?.circles) ? r.circles : [];
      return { circles: ids.map((b) => (typeof b === 'string' ? { id: b } : b)) };
    } catch { return { circles: [] }; }
  }

  // No prompt when nobody is watching: a scenario script drives this over a pipe and every 'walk> '
  // would land in the middle of the output it has to read.
  const interactive = Boolean(process.stdin.isTTY);
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout, prompt: 'walk> ' })
    : createInterface({ input: process.stdin, terminal: false });
  if (interactive) rl.prompt();

  /**
   * Commands run ONE AT A TIME, and shutdown waits for the queue.
   *
   * A typist cannot outrun this; a pipe can. Feed several lines at once and readline emits them all
   * before the first `await` resolves, so the commands interleave — and then EOF fires `close`, which
   * called `process.exit(0)` out from under whatever was still in flight. Piping three commands in
   * produced the output of one and no error at all (found B3, 2026-08-02). Serialising is what makes
   * this drivable by a script rather than only by a person.
   */
  let queue = Promise.resolve();
  const enqueue = (fn) => { queue = queue.then(fn, fn); return queue; };

  rl.on('line', (line) => enqueue(async () => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return interactive ? rl.prompt() : undefined;
    if (cmd === 'quit' || cmd === 'exit') return rl.close();
    const fn = commands[cmd];
    if (!fn) { console.log(`unknown: ${cmd} (try \`help\`)`); emit({ cmd, error: 'unknown-command' }); }
    else {
      try {
        const res = await fn(...args);
        emit({ cmd, ...(res && typeof res === 'object' ? res : {}) });
      } catch (err) {
        console.log('error:', err?.message ?? err);
        emit({ cmd, error: String(err?.message ?? err) });
      }
    }
    if (interactive) rl.prompt();
  }));
  rl.on('close', () => enqueue(async () => {
    try { await me.agent.stop?.(); } catch { /* best-effort */ }
    try { await relay?.close?.(); } catch { /* best-effort */ }
    process.exit(0);
  }));
}

main().catch((err) => { console.error('[walk-peer] failed to start:', err); process.exit(1); });
