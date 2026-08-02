/**
 * LAYER 1 — no accept/reject decision in the relay is made on the basis of circle knowledge.
 *
 * The relay's strongest privacy claim (`server.js` header, `plans/DESIGN-boundary-authentication.md`
 * §2) is that it knows which ADDRESSES exist and who controls them, never which CIRCLES exist and
 * who belongs to them. `J-B15` is that claim's journey, and a journey cannot carry it: a person
 * sitting at a relay writing down what they saw cannot demonstrate a negative.
 *
 * ── WHY THIS IS NOT "grep the relay for group references" ────────────────────────────────────────
 * Because that fails on the first run, on paths that are there on purpose, and a guard that fails
 * on day one teaches everyone to ignore it. One group-aware path survives by design (the
 * `msgsPerDay` quota — the `group-publish` fan-out that was the other one went on 2026-07-31), and
 * a second — the blob-gate ACL — turned out to be a durable member list nobody had written down. So
 * the guard is written against the DECISION, with the exceptions as data carrying a reason each:
 *
 *   1. every circle-aware line in `src/**` is on the allow-list, classified by what it is FOR;
 *   2. the vocabulary of "what it is for" has no slot for deciding circle membership;
 *   3. the register accept/reject decision provably cannot read the membership maps — they are not
 *      touched until after the registration has already been accepted;
 *   4. the forward decision (`clients.get(to)`) is reached with no circle knowledge in scope;
 *   5. what the relay writes down — logs and durable columns — is enumerated, not pattern-matched.
 *
 * The allow-list lives in `whatTheRelayMayLearn.js` because it IS the claim, and it should shrink as
 * the dumb-relay work lands.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CIRCLE_KNOWLEDGE_TOKENS,
  DECISION_KINDS,
  CIRCLE_AWARE_MODULES,
  CIRCLE_AWARE_CALL_SITES,
  PERSISTED_COLUMNS,
  KNOWN_HOLES,
} from './whatTheRelayMayLearn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC  = join(HERE, '../../src');

/* ── reading the source the way a decision does ─────────────────────────────────────────────────
 * Comments are stripped first. Prose about circles is exactly what we want people to keep writing —
 * `server.js`'s header explains this whole boundary and would otherwise be the biggest violation in
 * the file. What the guard is about is code that RUNS.
 */

/** Strip line/block comments, preserving strings, template literals and regex literals. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prevSignificant = '';
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === quote) { out += quote; i++; break; }
        out += src[i] === '\n' ? '\n' : src[i];
        i++;
      }
      prevSignificant = quote;
      continue;
    }
    // Regex-literal heuristic: a `/` in operand position starts one. `verbose.js` has real regex
    // literals containing `/`-like bytes, and mis-parsing one would silently swallow the rest of a
    // file — i.e. would make the guard pass by seeing nothing.
    if (c === '/' && /[=(,:[!&|?{};+\-*%~^]/.test(prevSignificant || '(')) {
      let j = i + 1; let inClass = false; let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        else if (d === '\n') break;
        j++;
      }
      if (closed) { out += ' '.repeat(j - i + 1); i = j + 1; continue; }
    }
    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out;
}

const TOKEN_RE = new RegExp(`\\b(${CIRCLE_KNOWLEDGE_TOKENS.join('|')})\\b`, 'i');

/** One code line, normalised so re-indentation and comment edits do not move it. */
const normalise = (line) => line.trim().replace(/\s+/g, ' ');

function relaySourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) out.push(p);
    }
  };
  walk(SRC);
  return out.sort();
}

/** Every executable line in `src/**` that mentions circle knowledge, as {file, code}. */
function circleAwareLines() {
  const hits = [];
  for (const file of relaySourceFiles()) {
    const rel = relative(SRC, file);
    for (const line of stripComments(readFileSync(file, 'utf8')).split('\n')) {
      const code = normalise(line);
      if (code && TOKEN_RE.test(code)) hits.push({ file: rel, code });
    }
  }
  return hits;
}

const multiset = (items) => {
  const m = new Map();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
};

/* ══ 1. The guard guards itself ═══════════════════════════════════════════════════════════════════
 * A source scanner that silently stops matching is a guard that passes forever. These four run
 * first, on purpose.
 */

describe('the scanner itself is honest', () => {
  it('strips comments but keeps the code they sit on', () => {
    const stripped = stripComments(readFileSync(join(SRC, 'server.js'), 'utf8'));
    // A phrase that exists ONLY in the file header prose.
    expect(readFileSync(join(SRC, 'server.js'), 'utf8')).toContain('never which **circles** exist');
    expect(stripped).not.toContain('never which **circles** exist');
    // …while the code around it survives intact.
    expect(stripped).toContain('const groupByAddress = new Map();');
    expect(stripped).toContain("if (msg.type === 'register')");
  });

  it('survives regex literals without swallowing the rest of the file', () => {
    // `blobGateMount.js` has a real regex literal (`bearerFrom`) with more of the file after it. If
    // the heuristic mis-fired, everything past it would vanish and every guard below would pass by
    // seeing nothing. It used to be `verbose.js` that carried this duty — its two character-class
    // regexes went with the plaintext canary's rewrite on 2026-07-31, so the check moved rather than
    // being dropped, and the synthetic below pins the nastier case (a `/` inside a character class)
    // that no source file happens to contain today.
    const stripped = stripComments(readFileSync(join(SRC, 'blobGateMount.js'), 'utf8'));
    expect(stripped).toContain('function bearerFrom(auth)');
    expect(stripped).toContain('function readJsonBody(req)');

    const synthetic = stripComments(
      'const SEP = /[a-z/]+/g;\n'
      + 'const kept = clientsByGroup;\n',
    );
    expect(synthetic).toContain('const kept = clientsByGroup;');
  });

  it('detects a NEW circle read — the failure this whole file exists to produce', () => {
    const synthetic = stripComments(`
      // a comment mentioning clientsByGroup must not count
      function decide(address) {
        if (clientsByGroup.get(circleOf(address))) return false;   // this must count
        return true;
      }
    `);
    const matched = synthetic.split('\n').map(normalise).filter(l => l && TOKEN_RE.test(l));
    expect(matched).toEqual(['if (clientsByGroup.get(circleOf(address))) return false;']);
  });

  it('is not vacuous — it finds the group-aware path that really is there', () => {
    const hits = circleAwareLines();
    expect(hits.length).toBeGreaterThan(40);
    // The `msgsPerDay` quota's read of `groupByAddress` — the last circle-aware read on a data path,
    // and therefore the line whose disappearance would mean the scanner had stopped matching. (It
    // used to be `const memberSet = clientsByGroup.get(groupId);`, which is gone with the fan-out.)
    expect(hits.some(h =>
      h.code === 'const senderGroup = registeredAddress ? groupByAddress.get(registeredAddress) : null;',
    )).toBe(true);
  });
});

/* ══ 2. The allow-list ════════════════════════════════════════════════════════════════════════════ */

describe('every circle-aware line in the relay is accounted for', () => {
  const moduleFiles = new Set(CIRCLE_AWARE_MODULES.map(m => m.file));

  it('the modules listed wholesale still exist (a rename must not silently drop coverage)', () => {
    for (const m of CIRCLE_AWARE_MODULES) {
      expect(() => statSync(join(SRC, m.file)), `${m.file} is allow-listed but missing`).not.toThrow();
    }
  });

  it('no NEW circle-aware line has appeared, and none has been quietly edited', () => {
    const found    = circleAwareLines().filter(h => !moduleFiles.has(h.file));
    const declared = CIRCLE_AWARE_CALL_SITES.flatMap(e => e.lines.map(code => ({ file: e.file, code })));

    const key = (h) => `${h.file} ‖ ${h.code}`;
    const foundCounts    = multiset(found.map(key));
    const declaredCounts = multiset(declared.map(key));

    const undeclared = [...foundCounts].filter(([k, n]) => n > (declaredCounts.get(k) ?? 0)).map(([k]) => k);
    const stale      = [...declaredCounts].filter(([k, n]) => n > (foundCounts.get(k) ?? 0)).map(([k]) => k);

    expect(undeclared, 'A line in packages/relay/src touches circle knowledge and is not on the '
      + 'allow-list in whatTheRelayMayLearn.js. Add it with a decision kind, a written reason and an '
      + 'exit path — or, better, do not add the line. If the honest reason is "it decides who belongs '
      + 'to a circle", that is the boundary this guard exists to hold: talk to Frits.').toEqual([]);
    expect(stale, 'The allow-list names lines that no longer exist. If circle knowledge has been '
      + 'REMOVED from the relay, delete the entry and celebrate — the list is meant to shrink.').toEqual([]);
  });

  it('every entry says what kind of decision it feeds, why, and how it ends', () => {
    for (const entry of [...CIRCLE_AWARE_CALL_SITES, ...CIRCLE_AWARE_MODULES]) {
      expect(Object.values(DECISION_KINDS), `${entry.what ?? entry.file}: unknown decision kind`)
        .toContain(entry.decision);
      expect(entry.why.length, `${entry.what ?? entry.file}: the reason must be written, not gestured at`)
        .toBeGreaterThan(80);
    }
    for (const entry of CIRCLE_AWARE_CALL_SITES) {
      expect(entry.exitPath?.length, `${entry.what}: needs an exit path — how this stops being true`)
        .toBeGreaterThan(20);
    }
  });

  it('the vocabulary has no slot for deciding circle membership', () => {
    // The closure is the assertion. A future line whose honest classification is "it decides whether
    // this person belongs to this circle" has nowhere to go, so the guard fails until either the line
    // goes or someone argues the vocabulary open in the open.
    expect(new Set(Object.values(DECISION_KINDS))).toEqual(new Set([
      'operator-serving-policy',
      'operator-resource-policy',
      'bookkeeping',
      'operator-log',
    ]));
    // `fan-out-delivery` was in this set until 2026-07-31. It classified exactly one thing — the
    // `group-publish` fan-out — and when that went, the slot went with it: an empty pigeonhole is an
    // invitation for the next fan-out to file itself as already-approved. The vocabulary is meant to
    // shrink as the relay learns less, and each shrink is pinned here so it cannot be undone quietly.
  });
});

/* ══ 3. The decision paths themselves ═════════════════════════════════════════════════════════════
 * The allow-list says which lines may exist. These say where they may sit — which is the part that
 * makes "no accept/reject decision reads circle knowledge" a structural fact rather than a reading.
 */

const SERVER = stripComments(readFileSync(join(SRC, 'server.js'), 'utf8'));

/** The body of one `if (msg.type === '<t>')` branch, up to the start of the next one. */
function frameBranch(type, nextType) {
  const start = SERVER.indexOf(`if (msg.type === '${type}')`);
  const end   = SERVER.indexOf(`if (msg.type === '${nextType}')`);
  expect(start, `branch '${type}' not found — the guard must not pass by looking at nothing`)
    .toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SERVER.slice(start, end);
}

describe('the register accept/reject decision cannot read circle membership', () => {
  // Registration is two frames since 2026-07-31 (proof of possession, Decision 3): `register` ASKS
  // and is answered with a challenge; `register-proof` is the only path to a routing-table entry.
  // Both halves are read separately, because "the ask cannot register anyone" is now a claim worth
  // asserting in its own right.
  const registerAsk   = frameBranch('register', 'register-proof');
  const registerProve = frameBranch('register-proof', 'send');

  it('the ask registers nobody — no unproven address can reach the routing table', () => {
    // The structural half of Decision 3. If `clients.set` ever appears in the branch that answers
    // `register`, an address is being routed to on the strength of a claim again — which is the
    // exact defect (finding 2/4, measured on hardware 2026-07-30) this whole change removes.
    expect(registerAsk, 'the `register` branch can register an address without a proof')
      .not.toContain('clients.set(');
    expect(registerAsk, 'the relay must answer a register with a challenge').toContain("type: 'challenge'");
    // …and the proof is verified BEFORE the acceptance, not logged after it.
    const verified = registerProve.indexOf('verifyAddressPossession(');
    const accepted = registerProve.indexOf('clients.set(address, socket)');
    expect(verified, 'the proof is never verified').toBeGreaterThan(-1);
    expect(accepted).toBeGreaterThan(-1);
    expect(verified, 'the address is registered before its proof is checked').toBeLessThan(accepted);
  });

  it('the membership map is not touched until AFTER the registration is accepted', () => {
    // `clients.set(address, socket)` IS the acceptance: past that line the client is registered and
    // its traffic routes. Everything group-shaped happens after it, so it cannot be an input to it.
    const accepted = registerProve.indexOf('clients.set(address, socket)');
    expect(accepted).toBeGreaterThan(-1);

    // One map, down from two: `clientsByGroup` (groupId → members) went with the `group-publish`
    // fan-out on 2026-07-31, so there is no longer a set of who is in a circle to read at all. What
    // is left is per-address — "which meter does this one spend against" — and it is still written
    // strictly after the acceptance, which is what makes "the register decision cannot read circle
    // membership" structural rather than a reading of the prose.
    const first = registerProve.indexOf('groupByAddress');
    expect(first, 'groupByAddress is never touched on the register path').toBeGreaterThan(-1);
    expect(first, 'groupByAddress is read BEFORE the registration is accepted — the relay would then '
      + 'be deciding who may connect on the basis of a circle it thinks they belong to')
      .toBeGreaterThan(accepted);
    // Nor is it read at all on the way to a challenge: the ask must not consult it either.
    expect(registerAsk, 'the challenge decision reads the group map').not.toContain('groupByAddress');

    // …and the map that WAS a roster is gone from the whole file, not merely from this branch.
    expect(SERVER, 'the groupId → members set is back — the relay must not hold one')
      .not.toContain('clientsByGroup');
  });

  it('the only circle-aware input to the decision is the operator\'s own serving policy', () => {
    const circleLines = registerAsk.split('\n').map(normalise).filter(l => l && TOKEN_RE.test(l));
    expect(circleLines).toEqual([
      'const { address, groupProof, rotationProof } = msg;',
      'const auth = groupAuth.verifyBound({',
      'proof: groupProof,',
      // Not an input: the answer the two lines above produced, written down so the SECOND frame of
      // registration does not have to ask again. Nothing reads it back except the day quota.
      'meterGroupId: auth.group?.groupId ?? null,',
    ]);
    const provingLines = registerProve
      .slice(0, registerProve.indexOf('clients.set(address, socket)'))
      .split('\n').map(normalise).filter(l => l && TOKEN_RE.test(l));
    expect(provingLines, 'deciding whether a proof is good must read nothing about a circle')
      .toEqual([]);
  });

  it('every OTHER reason a registration is refused is circle-blind', () => {
    // Read the refusals out of the source rather than trusting the prose. The ask: address missing,
    // the per-connection address ceiling, the outstanding-challenge ceiling. The proof: no challenge
    // outstanding, an expired one, a signature that does not verify. Nothing else, and nothing that
    // could grow a circle input without failing the test above.
    const refusalsIn = (branch) => [...branch.matchAll(/message: '([A-Z_a-z ]+)'/g)].map(m => m[1]);
    expect(refusalsIn(registerAsk)).toEqual([
      'Missing address', 'TOO_MANY_ADDRESSES', 'TOO_MANY_CHALLENGES',
    ]);
    expect(refusalsIn(registerProve)).toEqual([
      'NO_CHALLENGE', 'CHALLENGE_EXPIRED', 'PROOF_INVALID',
    ]);
  });
});

describe('the forward decision is circle-blind', () => {
  // `send` used to be bounded by the `group-publish` branch that followed it. That branch was removed
  // on 2026-07-31, so the bound moved to the next frame in the handler — and the removal is asserted
  // in its own right below rather than being implied by a slice that quietly got longer.
  const send = frameBranch('send', 'register-push-token');

  it('where a message goes is decided with no circle knowledge in scope', () => {
    const routing = send.indexOf('const online = clients.get(to);');
    expect(routing).toBeGreaterThan(-1);
    const afterRouting = send.slice(routing);
    const leftovers = afterRouting.split('\n').map(normalise).filter(l => l && TOKEN_RE.test(l));
    expect(leftovers, 'the routing half of `send` must reach no circle state').toEqual([]);
  });

  it('there is no frame that names a circle on the wire', () => {
    // The `group-publish` frame carried a `groupId` in cleartext, before the relay decided anything:
    // sending one told the relay that a named circle exists — the exact sentence the claim denies. It
    // survived on "no shipped client sends it", which is a convention, not a gate
    // (`docs/conventions/enforceability.md`). Removed 2026-07-31; the handler branch and the
    // membership map it read are both gone, and this is the line that fails if either comes back.
    expect(SERVER).not.toContain('group-publish');
    expect(SERVER).not.toContain('clientsByGroup');
    // A broadcast is now N `send` frames, sent by the party that holds the roster — the client.
  });

  it('the one circle-aware read on this path is the operator\'s day quota, and it says so', () => {
    expect(send).toContain('groupByAddress.get(registeredAddress)');
    expect(send).toContain('cfg?.quotas?.msgsPerDay');
    expect(send).toContain('OVER_QUOTA_MSGS_PER_DAY');
  });
});

/* ══ 4. What the relay writes down ════════════════════════════════════════════════════════════════ */

describe('the relay does not write circles down', () => {
  it('the verbose hop log is handed a frame kind and two addresses — never a group', () => {
    // `logHop` is the one logger that sees an envelope. Its call sites are enumerated so that a
    // future `logHop({ ..., groupId })` fails here rather than shipping a circle id into stdout.
    const calls = [...SERVER.matchAll(/logHop\(\{([^}]*)\}/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) {
      const keys = [...call.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map(m => m[1]);
      const bare = [...call.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=,|$)/g)].map(m => m[1]);
      for (const key of [...keys, ...bare]) {
        expect(['kind', 'from', 'to', 'envelope', 'payload'], `logHop got an unexpected field: ${key}`)
          .toContain(key);
      }
    }
  });

  it('every persisted column is enumerated, so a member list cannot arrive under a neutral name', () => {
    // Deliberately exhaustive rather than pattern-matched. The real leak in this package is not
    // called `circle_id`; it is called `actorId`, and a grep for "circle" walks straight past it.
    const declared = new Set(PERSISTED_COLUMNS.map(c => `${c.file} ‖ ${c.table} ‖ ${c.column}`));
    const found = new Set();
    for (const file of relaySourceFiles()) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)\s*\(([^;]*?)\)\s*[`;)]/gs)) {
        const table = m[1];
        for (const raw of m[2].split('\n')) {
          const col = normalise(raw).match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(TEXT|INTEGER|BLOB|REAL)\b/);
          if (col) found.add(`${relative(SRC, file)} ‖ ${table} ‖ ${col[1]}`);
        }
      }
    }
    expect(found.size, 'no schema was parsed — the guard would pass by seeing nothing').toBeGreaterThan(10);
    expect([...found].filter(f => !declared.has(f)),
      'A new durable column. Say what it holds in PERSISTED_COLUMNS — and if the answer is "who is '
      + 'in a circle with whom", that is the thing the relay must not keep.').toEqual([]);
    expect([...declared].filter(d => !found.has(d)), 'PERSISTED_COLUMNS names a column that is gone')
      .toEqual([]);
  });

  it('each known hole says what it leaks, when it is reachable, and what closes it', () => {
    expect(KNOWN_HOLES.length).toBeGreaterThan(0);
    for (const hole of KNOWN_HOLES) {
      expect(hole.leaks.length, `${hole.id}: state the leak`).toBeGreaterThan(40);
      expect(hole.reachableOnlyIf.length, `${hole.id}: state when it is reachable`).toBeGreaterThan(10);
      expect(hole.exitPath.length, `${hole.id}: state what closes it`).toBeGreaterThan(20);
      expect(hole.filedIn, `${hole.id}: a hole nobody has filed is a hole nobody will close`).toBeTruthy();
    }
  });
});
