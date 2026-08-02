// Tests for the ledger-drift guard (scripts/lint-ledger.mjs).
//   npm run test:ledger   (root)  →  vitest run scripts/lint-ledger.test.mjs
//
// The guard exists because a written-down rule failed four times. So the tests reproduce the four
// observed drifts as fixtures and assert the guard FAILS on each — a guard nobody has watched fail is
// indistinguishable from one that doesn't work. The fourth drift (an item overtaken by built code) is
// deliberately NOT claimed: there is a test asserting the guard stays silent about it, so the limitation
// is recorded rather than forgotten.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GUARD = new URL('lint-ledger.mjs', import.meta.url).pathname;

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ledger-guard-'));
  mkdirSync(join(root, 'plans'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Run the guard against the fixture tree; return {code, out}. */
function run(args = []) {
  try {
    const out = execFileSync('node', [GUARD, ...args], {
      encoding: 'utf8',
      env: { ...process.env, LEDGER_LINT_ROOT: root },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const ledger = (open, answered = '') => `# Some other section

Prose above the ledger.

# ? Needs Frits — open DESIGN questions (the ledger)

## Open

${open}

## Answered — kept, because they are now specifications for unbuilt work

${answered}
`;

const write = (rel, body) => writeFileSync(join(root, rel), body);
const baseline = () => run(['--update']);

describe('the guard is silent when there is nothing to guard', () => {
  it('skips cleanly when REMAINING-WORK.md is absent — it is gitignored by design', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toMatch(/not present/i);
  });

  it('passes a well-formed ledger', () => {
    write('REMAINING-WORK.md', ledger('1. **[L1] Should we do the thing?** Either way is defensible.'));
    baseline();
    expect(run().code).toBe(0);
  });
});

describe('drift 1 — a question raised in a doc that never reached the ledger', () => {
  beforeEach(() => {
    write('REMAINING-WORK.md', ledger('1. **[L1] Should we do the thing?**'));
    baseline();
  });

  it('fails when a NEW un-annotated marker appears in a private doc', () => {
    write('plans/DESIGN-something.md', 'We could go either way here.\n\nThis one is **Frits\' call**.\n');
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain('DESIGN-something.md');
    expect(out).toMatch(/does not count as being on the ledger/);
  });

  it('accepts the marker once it carries a ledger id', () => {
    write('plans/DESIGN-something.md', "This one is **Frits' call** [ledger L1].\n");
    expect(run().code).toBe(0);
  });

  it('accepts an explicit n/a for a rhetorical or already-answered mention', () => {
    write('plans/DESIGN-something.md', "It was **Frits' call** and he made it [ledger n/a].\n");
    expect(run().code).toBe(0);
  });

  it('does NOT fail on markers that were already there when the baseline was taken', () => {
    // the 97 pre-existing sites must not block every run; only growth is an error
    write('plans/OLD.md', "**Needs Frits:** an old one.\n");
    baseline();
    expect(run().code).toBe(0);
  });
});

describe('drifts 3 and 4 — an item answered lower in the same file, still sitting under Open', () => {
  it('fails when one id is both Open and Answered', () => {
    write('REMAINING-WORK.md', ledger(
      '1. **[L1] Should we do the thing?**',
      '- **✔ [L1] (07-31) — YES, do the thing.**',
    ));
    baseline();
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/BOTH "Open" and "Answered"/);
  });

  it('fails when an Open id is ticked anywhere else in the file', () => {
    write('REMAINING-WORK.md', `${ledger('1. **[L2] Still open?**')}\n- ✔ [L2] settled in passing\n`);
    baseline();
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/appears marked ✔ elsewhere/);
  });
});

describe('stale cross-references — what the [L<n>] ids are actually for', () => {
  it('fails on a reference to an id that exists on neither list', () => {
    write('REMAINING-WORK.md', `${ledger('1. **[L1] Open one.**')}\n\nBlocked on this [Frits — ledger L9].\n`);
    baseline();
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/ledger L9.*neither/s);
  });

  it('fails when something still asks Frits about an id that is Answered', () => {
    write('REMAINING-WORK.md', `${ledger(
      '1. **[L1] Open one.**',
      '- **✔ [L4] (07-31) — decided.**',
    )}\n\nWaiting on it [Frits — ledger L4].\n`);
    baseline();
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/still asks for a decision, but L4 is Answered/);
  });
});

describe('structural requirements', () => {
  it('fails an Open item with no id — ids are what stop references rotting', () => {
    write('REMAINING-WORK.md', ledger('1. **Should we do the thing?** No id here.'));
    baseline();
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/no \[L<n>\] id/);
  });

  it('fails two Open items sharing an id', () => {
    write('REMAINING-WORK.md', ledger('1. **[L1] One?**\n2. **[L1] Two?**'));
    baseline();
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/share the id L1/);
  });

  it('fails loudly if the ledger section itself disappears', () => {
    write('REMAINING-WORK.md', '# Just a todo file\n\n- do things\n');
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/no ledger heading/i);
  });

  it('does not mistake an italic scene-setting line for an item', () => {
    write('REMAINING-WORK.md', ledger('*The boundary model — the six of §13:*\n\n1. **[L1] A real one?**'));
    baseline();
    expect(run().code).toBe(0);
  });
});

describe('the limitation, recorded as a test rather than a comment', () => {
  it('does NOT catch an item whose text has been overtaken by built code', () => {
    // drift 2: the ledger described a rename that had already happened. Nothing in the text is
    // malformed, so the guard passes. This test exists so the gap stays visible and nobody assumes
    // a green run means the ledger is TRUE — only that it is well-formed.
    write('REMAINING-WORK.md', ledger('1. **[L1] Should we rename the thing?** (it was renamed last week)'));
    baseline();
    expect(run().code).toBe(0);
  });
});
