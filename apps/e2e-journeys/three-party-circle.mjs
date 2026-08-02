#!/usr/bin/env node
/**
 * three-party-circle — THREE participants, THREE OS processes, one real relay, one circle.
 *
 * ── Why a third process and not a third agent ───────────────────────────────────────────────────────
 * `apps/basis/test/v2/circleAddressAnnounce.relay.test.js` already boots three real agents on a real
 * relay — but in ONE process, sharing a module registry, a clock and an event loop. That is enough to
 * prove the addressing protocol and not enough to prove a device: anything accidentally shared (a
 * module-level cache, an ordering that only holds because one agent's microtask ran before another's)
 * is invisible there. Three processes each hold their own identity, their own stores and their own
 * socket, and reach each other over nothing but the relay. Frits' rule: three-device stories catch the
 * second operation that silently breaks the first.
 *
 * Each participant is `walk-peer.mjs` — the same headless harness the on-device journey walks drive,
 * booting the same `createRealHouseholdAgent` both shells boot — run in `--machine` mode so this
 * script can read results instead of prose.
 *
 * ── The configuration ───────────────────────────────────────────────────────────────────────────────
 * `--address-fallback=off`: the private default, "rather undeliverable than routed over my one global
 * key". With the fallback ON every assertion below also passes when per-circle addressing is broken,
 * which is exactly how that class of bug survives a green run.
 *
 * ── What it asserts, and why it asserts RECEIPT ─────────────────────────────────────────────────────
 * A send reports what the SEND PATH accepted. A member who is addressable but not authorized has their
 * envelope refused on arrival, silently — the sender sees a clean `sent: 2`. So every cell of the
 * matrix is a poll of the RECIPIENT's own message log; the fan's `sent`/`errors` are recorded as
 * context, never as the verdict. For the same reason each participant's own stderr is watched for
 * refusals and reported as FINDINGS: an envelope that was refused rather than lost leaves a trace on
 * exactly one side, and it is never the sender's.
 *
 *   node apps/e2e-journeys/three-party-circle.mjs                      # ws://127.0.0.1:8787
 *   node apps/e2e-journeys/three-party-circle.mjs ws://host:8787       # another relay
 *   VERBOSE=1 node apps/e2e-journeys/three-party-circle.mjs            # forward each peer's own output
 *
 * Exit 0 = every checked direction delivered · 1 = at least one did not · 2 = the run could not be set up.
 * FINDINGS do not fail the run: they are things that are true of the product, and what to do about
 * them is not this script's call.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WALK_PEER = join(HERE, 'walk-peer.mjs');

const RELAY_URL = process.argv[2] ?? process.env.RELAY_URL ?? 'ws://127.0.0.1:8787';
const VERBOSE = process.env.VERBOSE === '1';
const CMD_TIMEOUT_MS = 90_000;
/** How long a fact is given to cross the relay before it is called absent. */
const SETTLE_MS = 30_000;

const rnd = () => Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lines a participant prints about itself that mean something was refused, or quietly downgraded. */
const TRACES = [
  ['refusedCanonical', 'is a MEMBER\'s canonical identity'],
  ['refusedStranger', 'is not on its roster'],
  ['unknownRoster', 'no roster recorded for own circle address'],
  ['sendAsFallback', 'which this transport does not hold — falling back to the primary address'],
];

/** One participant: a walk-peer child process, driven one command at a time. */
class Peer {
  constructor(handle) {
    this.handle = handle;
    this.pubKey = null;
    this.pending = null;          // the command awaiting its ##RESULT line
    this.traces = Object.fromEntries(TRACES.map(([k]) => [k, 0]));
  }

  async start() {
    this.proc = spawn(process.execPath, [
      WALK_PEER, RELAY_URL, `--handle=${this.handle}`, '--machine', '--address-fallback=off',
    ], { cwd: HERE, stdio: ['pipe', 'pipe', 'pipe'] });

    const readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });

    createInterface({ input: this.proc.stdout, terminal: false }).on('line', (line) => {
      if (line.startsWith('##RESULT ')) {
        let obj = null;
        try { obj = JSON.parse(line.slice('##RESULT '.length)); } catch { obj = { parseError: line }; }
        if (obj?.event === 'ready') {
          this.pubKey = obj.pubKey;
          this.addressFallback = obj.addressFallback;
          this._resolveReady(obj);
          return;
        }
        const p = this.pending;
        this.pending = null;
        if (p) { clearTimeout(p.timer); p.resolve(obj); }
        return;
      }
      if (VERBOSE) console.log(`[${this.handle}] ${line}`);
    });
    createInterface({ input: this.proc.stderr, terminal: false }).on('line', (line) => {
      for (const [key, needle] of TRACES) if (line.includes(needle)) this.traces[key] += 1;
      if (VERBOSE) console.log(`[${this.handle}!] ${line}`);
    });
    this.proc.on('exit', (code) => {
      const p = this.pending;
      this.pending = null;
      if (p) { clearTimeout(p.timer); p.reject(new Error(`${this.handle} exited (${code}) mid-command`)); }
      this._rejectReady?.(new Error(`${this.handle} exited (${code}) before it was ready`));
    });

    const timer = setTimeout(() => this._rejectReady(new Error(`${this.handle} never became ready`)), CMD_TIMEOUT_MS);
    const ready = await readyPromise;
    clearTimeout(timer);
    this._rejectReady = null;
    return ready;
  }

  /** Send one command and resolve with its result object. One in flight at a time (the child serialises). */
  send(line) {
    if (this.pending) return Promise.reject(new Error(`${this.handle}: a command is already in flight`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`${this.handle}: no result for \`${line}\` within ${CMD_TIMEOUT_MS}ms`));
      }, CMD_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      this.proc.stdin.write(`${line}\n`);
    });
  }

  /** A copy of the refusal/downgrade counters, for before/after deltas around one operation. */
  snapshotTraces() { return { ...this.traces }; }

  async stop() {
    try { this.proc.stdin.write('quit\n'); } catch { /* already gone */ }
    await Promise.race([new Promise((r) => this.proc.once('exit', r)), sleep(5000)]);
    try { this.proc.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

/** Poll `probe()` until it returns something truthy, or give up. Returns the value or null. */
async function until(probe, { timeout = SETTLE_MS, step = 1000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(step);
  }
}

const results = [];     // {name, ok, detail}
const findings = [];    // things that are true and that no assertion here decides about

const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const finding = (text) => { findings.push(text); console.log(`  FINDING  ${text}`); };

/** Does `recipient` hold a message with this exact text? */
async function delivered(recipient, text, opts) {
  return until(async () => {
    const r = await recipient.send('log');
    return Array.isArray(r?.texts) && r.texts.includes(text);
  }, opts);
}

/** One sender broadcasts; both other members are then checked for RECEIPT. */
async function broadcast(sender, circleId, others, label) {
  const text = `${label}-${rnd()}`;
  const fan = await sender.send(`post ${circleId} ${text}`);
  const context = `fan sent=${fan?.sent ?? '?'} errors=${JSON.stringify(fan?.errors ?? [])}`;
  const cells = [];
  for (const o of others) cells.push(record(`${sender.handle} → ${o.handle}`, Boolean(await delivered(o, text)), context));
  return cells.every(Boolean);
}

/** The row a peer holds for another member, by pubKey. */
async function rowFor(peer, circleId, otherPubKey) {
  const r = await peer.send(`members ${circleId}`);
  return (r?.members ?? []).find((m) => m?.pubKey === otherPubKey) ?? null;
}

async function main() {
  console.log(`three-party-circle — relay ${RELAY_URL}, address-fallback OFF\n`);

  const anna = new Peer('anna');   // admin
  const bram = new Peer('bram');   // first joiner
  const cato = new Peer('cato');   // second joiner — the one two participants never test
  const peers = [anna, bram, cato];

  try {
    for (const p of peers) {
      const ready = await p.start();
      if (ready.addressFallback !== false) {
        console.error(`SETUP: ${p.handle} booted with the address fallback ON — this run would prove nothing.`);
        process.exitCode = 2;
        return;
      }
      console.log(`  up    ${p.handle}  pid=${p.proc.pid}  pubKey=${p.pubKey.slice(0, 12)}…`);
    }
    if (new Set(peers.map((p) => p.pubKey)).size !== 3) {
      console.error('SETUP: two peers booted with the SAME identity — separate processes are not separate devices here.');
      process.exitCode = 2;
      return;
    }
    console.log('');

    // ── 1. the admin creates the circle ──────────────────────────────────────────────────────────
    const created = await anna.send(`circle Three Party ${rnd()}`);
    if (!created?.circleId || !created?.uri) {
      console.error(`SETUP: the admin could not create a circle: ${JSON.stringify(created)}`);
      process.exitCode = 2;
      return;
    }
    const circleId = created.circleId;
    console.log(`  circle ${circleId}\n`);

    // ── 2. the FIRST joiner, and a two-party exchange BEFORE the third exists ────────────────────
    //    This is what makes the run a three-participant story rather than a three-participant setup:
    //    bram records a roster snapshot of a TWO-member circle, and then a third member appears.
    const joinB = await bram.send(`join ${created.uri}`);
    record('bram joins', Boolean(joinB?.ok), joinB?.ok ? circleId : JSON.stringify(joinB));
    if (!joinB?.ok) { process.exitCode = 1; return; }

    console.log('\n— two participants (the baseline the third must not break) —');
    const twoPartyText = `two-party-${rnd()}`;
    const twoPartyFan = await bram.send(`post ${circleId} ${twoPartyText}`);
    record('bram → anna (before cato exists)', Boolean(await delivered(anna, twoPartyText)),
      `fan sent=${twoPartyFan?.sent ?? '?'} errors=${JSON.stringify(twoPartyFan?.errors ?? [])}`);

    // ── 3. the SECOND joiner — a member added AFTER bram cached its roster ───────────────────────
    console.log('\n— the third participant arrives —');
    const invite2 = await anna.send(`invite ${circleId}`);
    if (!invite2?.uri) {
      console.error(`SETUP: no second invite: ${JSON.stringify(invite2)}`);
      process.exitCode = 2;
      return;
    }
    const joinC = await cato.send(`join ${invite2.uri}`);
    record('cato joins (same circle, a DIFFERENT handle)', Boolean(joinC?.ok),
      joinC?.ok ? circleId : JSON.stringify(joinC));
    if (!joinC?.ok) { process.exitCode = 1; return; }

    // ── 4. did cato's arrival reach the OTHER JOINER, or only the admin? ─────────────────────────
    //    The admin learns a joiner's address from the redeem itself. bram learns it only if somebody
    //    tells him. That asymmetry does not exist with two participants.
    const annaSeesCato = await until(async () => (await rowFor(anna, circleId, cato.pubKey))?.circleAddress);
    record('anna (admin) holds cato\'s per-circle address', Boolean(annaSeesCato));
    const bramSeesCato = await until(async () => (await rowFor(bram, circleId, cato.pubKey))?.circleAddress);
    record('bram (joiner) holds cato\'s per-circle address', Boolean(bramSeesCato),
      bramSeesCato ? 'reached a peer, not just the admin' : `nothing within ${SETTLE_MS}ms`);
    const catoSeesBram = await until(async () => (await rowFor(cato, circleId, bram.pubKey))?.circleAddress);
    record('cato holds bram\'s per-circle address', Boolean(catoSeesBram));
    const catoSeesAnna = await until(async () => (await rowFor(cato, circleId, anna.pubKey))?.circleAddress);
    record('cato holds anna\'s per-circle address', Boolean(catoSeesAnna));

    // Each address must be the one that device itself derives — a recorded CLAIM would look identical
    // on a roster and route to nobody.
    for (const [holder, subject] of [[anna, cato], [bram, cato], [cato, bram], [cato, anna]]) {
      const row = await rowFor(holder, circleId, subject.pubKey);
      const own = (await subject.send('whoami'))?.circles?.find((c) => c.id === circleId)?.circleAddress ?? null;
      if (row?.circleAddress && own) {
        record(`${holder.handle}'s row for ${subject.handle} is the address ${subject.handle} derives`,
          row.circleAddress === own, row.circleAddress === own ? '' : `${row.circleAddress} ≠ ${own}`);
      }
    }

    // ── 5. the matrix — six directions, asserted on RECEIPT ──────────────────────────────────────
    console.log('\n— the six directions —');
    await broadcast(anna, circleId, [bram, cato], 'from-anna');
    await broadcast(bram, circleId, [anna, cato], 'from-bram');
    await broadcast(cato, circleId, [anna, bram], 'from-cato');

    // ── 6. the oracle can say NO ─────────────────────────────────────────────────────────────────
    //    Every cell above is a poll of a message log. A poll that can only ever answer "yes" is a
    //    green light wired to the mains, so ask for something nobody sent.
    console.log('\n— the control —');
    record('a message nobody sent is NOT reported as delivered',
      !(await delivered(bram, `never-sent-${rnd()}`, { timeout: 4000, step: 500 })));

    // ── 7. re-announce at STEADY STATE — the second operation that can break the first ──────────
    //    An announcement carries a proof and refreshes both the addressing AND the snapshot that
    //    decides who may speak. If it refreshed only the first, the announcer would be addressable
    //    and then refused — failing after appearing to work. Delivery afterwards is the only
    //    assertion that covers both halves, because a refused envelope is silent.
    console.log('\n— a re-announce, with the circle already settled —');
    const before = Object.fromEntries(peers.map((p) => [p.handle, p.snapshotTraces()]));
    for (const p of [bram, cato]) {
      const r = await p.send(`announce ${circleId}`);
      record(`${p.handle} can re-prove its address`, Boolean(r?.announced) && (r?.sent ?? 0) >= 1,
        JSON.stringify(r));
    }
    await sleep(3000);
    for (const p of peers) {
      const delta = p.traces.refusedCanonical - before[p.handle].refusedCanonical;
      record(`${p.handle} refused nothing during the re-announce`, delta === 0, `refusedCanonical +${delta}`);
    }
    await broadcast(bram, circleId, [anna, cato], 'after-re-announce');

    // ── 8. is anyone accepting traffic UNCHECKED? ────────────────────────────────────────────────
    //    A delivery only proves authorization if the receiver actually checks. `installed:false`, or
    //    a circle count of zero, means everything above was accepted because nothing said no.
    console.log('\n— what each participant actually enforces —');
    for (const p of peers) {
      const { auth } = await p.send('auth');
      record(`${p.handle} enforces a real membership check`,
        Boolean(auth?.installed) && (auth?.circles ?? 0) >= 1, JSON.stringify(auth));
      if ((auth?.unknownRosterAllowances ?? 0) > 0) {
        finding(`${p.handle} accepted ${auth.unknownRosterAllowances} envelope(s) for a circle with NO roster snapshot`);
      }
      if ((auth?.canonicalOnlyMembers ?? 0) > 0) {
        finding(`${p.handle} still holds ${auth.canonicalOnlyMembers} member(s) known ONLY by their global key`);
      }
    }

    // ── 9. what each participant refused or downgraded, over the whole run ───────────────────────
    console.log('\n— refusals and downgrades, over the whole run —');
    for (const p of peers) {
      const t = p.traces;
      if (t.refusedCanonical) {
        finding(`${p.handle} REFUSED ${t.refusedCanonical} validly-signed envelope(s) from a member using their `
          + 'global key — silent to the sender, which reported them as sent');
      }
      if (t.refusedStranger) finding(`${p.handle} refused ${t.refusedStranger} envelope(s) as a stranger's`);
      if (t.sendAsFallback) {
        finding(`${p.handle} sent ${t.sendAsFallback} envelope(s) as its GLOBAL key after being asked to send as `
          + 'its per-circle one — the transport did not hold that address yet (the join-time window: a '
          + 'joiner announces before its alias is bound; swap the two calls in registerCirclePresence and '
          + 'both this and the refusals above go to zero)');
      }
      if (!t.refusedCanonical && !t.refusedStranger && !t.sendAsFallback) console.log(`  clean    ${p.handle}`);
    }
  } finally {
    for (const p of peers) { try { await p.stop(); } catch { /* best-effort */ } }
  }

  // ── the verdict ────────────────────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(76)}`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (findings.length) {
    console.log(`${'─'.repeat(76)}`);
    for (const f of findings) console.log(`FINDING  ${f}`);
  }
  console.log(`${'─'.repeat(76)}`);
  console.log(`${results.length - failed.length}/${results.length} checks passed`
    + (findings.length ? `, ${findings.length} finding(s) — see above` : ''));
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('three-party-circle: the run could not complete —', err?.message ?? err);
  process.exitCode = 2;
});
