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
import { bootRealAgentNode } from '../basis/test/support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../basis/src/v2/householdRosterPairing.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../basis/src/v2/circleInvite.js';
import { quickCreateCircle } from '../basis/src/v2/circleCreate.js';

const argUrl = process.argv[2] ?? process.env.RELAY_URL ?? null;

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

  const me = await bootRealAgentNode('walk-peer', { redeemTimeoutMs: 45_000 });
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
  console.log(`[walk-peer] my pubKey: ${me.pubKey}`);
  console.log('[walk-peer] type `help` for commands.\n');

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
  offline | online        drop / restore my transport
  log                     messages received since the last log
  quit`);
    },

    async whoami() {
      console.log(`pubKey: ${me.pubKey}`);
      const { circles } = await listCircles();
      for (const c of circles) {
        const addr = await me.agent.circleAddressFor?.(c.id);
        console.log(`  ${c.id}: ${addr ?? '(no per-circle address)'}`);
      }
    },

    async circle(...name) {
      const label = name.join(' ') || 'Walk circle';
      const r = await quickCreateCircle({ callSkill: call, name: label });
      if (!r?.groupId) return console.log('create failed:', JSON.stringify(r));
      console.log(`created ${r.groupId}`);
      await registerMyCircleAddresses();
      await commands.invite(r.groupId);
    },

    async invite(circleId) {
      if (!circleId) return console.log('usage: invite <circleId>');
      const r = await buildCircleInviteUri({
        callSkill: call, circleId,
        adminPeerAddr: me.pubKey,
        relayUrl,
      });
      if (r?.error) return console.log('invite failed:', r.error);
      console.log('\n' + r.uri + '\n');
      console.log('(paste this into the phone\'s "join a circle", or render it as a QR)');
    },

    async join(uri) {
      if (!uri) return console.log('usage: join <invite-uri>');
      const r = await joinCircleFromInvite({
        inviteUri: uri, callSkill: call, sendPeerRedeem: me.sendPeerRedeem, handle: 'walkpeer',
      });
      console.log(r?.ok ? `joined ${r.circleId}` : `join failed: ${JSON.stringify(r)}`);
      if (r?.ok) {
        await bindCircleAddressKeysFor({ agent: me.agent, circleId: r.circleId });
        await registerMyCircleAddresses();
      }
    },

    async post(circleId, ...rest) {
      const text = rest.join(' ');
      if (!circleId || !text) return console.log('usage: post <circleId> <text>');
      // `msgId` is required by the skill — the shells mint one per message and key delivery state on it
      // (`broadcastKringFanOut`). This tool did not, so `post` failed with `msgId-required` the first time
      // anyone tried to send from it (2026-07-30). Mirror what a shell does rather than inventing a shape.
      const msgId = `walk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const r = await call('stoop', 'broadcastKringMessage', {
        groupId: circleId, text, msgId, ts: Date.now(),
      });
      console.log('sent:', JSON.stringify(r));
      // `sent` counts recipients the send path accepted — HELD counts as sent. If the phone does not
      // show it, that is the interesting part: check the relay log before assuming a UI bug.
    },

    async circles() {
      const { circles } = await listCircles();
      if (!circles.length) return console.log('(none)');
      for (const c of circles) console.log(`  ${c.id}  ${c.name ?? ''}`);
    },

    async members(circleId) {
      if (!circleId) return console.log('usage: members <circleId>');
      const r = await call('stoop', 'listGroupMembers', { groupId: circleId });
      for (const m of r?.members ?? []) {
        console.log(`  ${String(m.webid ?? '?').slice(0, 20)}…  pubKey=${String(m.pubKey ?? '-').slice(0, 12)}…  circleAddress=${m.circleAddress ?? '-'}`);
      }
    },

    async offline() {
      await me.agent.sa?.relay?.disconnect?.();
      console.log('offline — sends to me should now be HELD, not lost');
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
    },

    async log() {
      const rows = me.chatEvents ?? [];
      if (!rows.length) return console.log('(nothing received)');
      for (const e of rows) console.log(`  [${e.type}] ${e.payload?.text ?? JSON.stringify(e.payload ?? {}).slice(0, 80)}`);
    },
  };

  /**
   * Register THIS peer's per-circle addresses on the relay — what a real shell does and this harness did not.
   *
   * Found finishing the round-trip (2026-07-30). A roster row carries a member's per-circle address, so peers
   * send to it. The shells register their aliases with the relay (`registerCircleAddresses`, wired at boot,
   * circles-load and join); walk-peer never did, so it was reachable only under its pubKey. Consequence: the
   * phone sent a chat message to walk-peer's roster address, the relay had never heard of that address, and
   * the message was undeliverable — while walk-peer's OWN sends worked fine, because the phone *had*
   * registered. So the harness could send but not be sent to, which read exactly like the phone failing to
   * deliver. Two harness bugs stacked (the other was the router signature) before the product was even in
   * question.
   *
   * Unscoped on purpose: a walk peer rides one relay and the scoping rule (a circle registers only on relays
   * it uses) is the shells' concern, tested there. Here the point is simply to be reachable.
   */
  async function registerMyCircleAddresses() {
    try {
      const relay = me.agent?.relay;
      if (!relay?.supportsAliases) return;
      const { circles } = await listCircles();
      for (const c of circles) {
        const addr = me.agent?.circleAddressFor?.(c.id);
        if (addr) await relay.addAddress(addr);
      }
    } catch (err) {
      console.log('[walk-peer] circle-address registration failed:', err?.message ?? err);
    }
  }

  async function listCircles() {
    try {
      // `listMyBuurts` is what the shells use (circleSources.fetchGroups) — it returns EVERY circle the
      // actor is in, including one just created. `getCurrentGroup` only ever returned the active one.
      const r = await call('stoop', 'listMyBuurts', {});
      const ids = Array.isArray(r?.buurts) ? r.buurts : [];
      return { circles: ids.map((b) => (typeof b === 'string' ? { id: b } : b)) };
    } catch { return { circles: [] }; }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'walk> ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return rl.prompt();
    if (cmd === 'quit' || cmd === 'exit') return rl.close();
    const fn = commands[cmd];
    if (!fn) console.log(`unknown: ${cmd} (try \`help\`)`);
    else {
      try { await fn(...args); } catch (err) { console.log('error:', err?.message ?? err); }
    }
    rl.prompt();
  });
  rl.on('close', async () => {
    try { await me.agent.stop?.(); } catch { /* best-effort */ }
    try { await relay?.close?.(); } catch { /* best-effort */ }
    process.exit(0);
  });
}

main().catch((err) => { console.error('[walk-peer] failed to start:', err); process.exit(1); });
