/**
 * The projection's own tests. A guard whose test is red is not a guard — and this one has two failure modes
 * that both LOOK like success, so they are pinned rather than trusted.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(process.cwd(), 'scripts', 'asked-frits.mjs');

/** Run the generator against a throwaway roadmap, so the real one is never touched by a test. */
function run(body, args = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'asked-frits-'));
  const file = path.join(dir, 'REMAINING-WORK.md');
  writeFileSync(file, body);
  const r = execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, ASKED_FRITS_FILE: file },
  });
  const text = readFileSync(file, 'utf8');
  // Assert on the BLOCK, never the whole file: the source rows stay where they are, so a question's words
  // are still in the document whether or not the table lists it. Checking the file would always "find" them.
  const block = text.slice(text.indexOf('<!-- asked-frits:begin -->'), text.indexOf('<!-- asked-frits:end -->'));
  return { out: r, text, block };
}

const BEGIN_END = '# roadmap\n<!-- asked-frits:begin -->\n<!-- asked-frits:end -->';

const BODY = [
  '# roadmap',
  '<!-- asked-frits:begin -->',
  '<!-- asked-frits:end -->',
  '',
  '# ? Needs Frits — open DESIGN questions (the ledger)',
  '1. **[L1] ? Needs Frits — should the thing be blue? [ledger L1]** raised 2026-09-01',
  '2. **[L2] ✅ DECIDED 2026-09-02 (Frits: "green")** Was: ? Needs Frits — should it be green?',
  '3. a brief that mentions `? Needs Frits` in passing',
  '',
].join('\n');

describe('asked-frits — the open-questions table is a projection, not a list', () => {
  it('projects a live marker, and NOT the three shapes that only look like one', () => {
    const { block } = run(BODY);
    expect(block, 'the live question is in').toMatch(/should the thing be blue\?/);
    expect(block, 'a heading is not a question').not.toMatch(/open DESIGN questions/);
    expect(block, 'text after `Was:` is an ANSWERED row keeping its wording').not.toMatch(/should it be green\?/);
    expect(block, 'prose quoting the marker is not a question').not.toMatch(/in passing/);
    expect(block).toMatch(/\*\*1 open\*\*/);
  });

  it('is IDEMPOTENT — it states line numbers, and rewriting moves them', () => {
    // The first version was not: the block resized, every line below shifted, and `--check` failed on a file
    // that had just been generated. It converges to a fixed point now.
    const { text: once } = run(BODY);
    const { text: twice } = run(once);
    expect(twice).toBe(once);
  });

  // The three shapes below are how the real ledger writes a marker. The first version read only the text AFTER
  // the marker on its own line, so a third of the table said "when]", "Opened 2026-09-09 from" or "first".
  it('reads a question written BEFORE the marker', () => {
    const { block } = run([BEGIN_END, '',
      '93. **[L93] Who carries the circle?** Custodian mode keeps one key. Does revocation move from the circle to',
      '    the node? ? Needs Frits [ledger L93]. Opened 2026-09-09 from the always-on plan.',
    ].join('\n'));
    expect(block).toMatch(/Does revocation move from the circle to the node\?/);
    expect(block).not.toMatch(/Opened 2026-09-09 from/);
  });

  it('uses the item title when the marker sits in the closing ledger tag, and keeps the ask', () => {
    const { block } = run([BEGIN_END, '',
      '123. **[L123] A PERSONA BECOMES A PERSON ON THE WIRE — designed, NOT built (found',
      '    2026-09-24).** Today one identity runs per person.',
      '    The arc is three to five days. [ledger L123 — ? Needs Frits: when]',
    ].join('\n'));
    expect(block).toMatch(/A PERSONA BECOMES A PERSON ON THE WIRE — designed, NOT built/);
    expect(block).toMatch(/when/);
    expect(block).not.toMatch(/\| when\] \|/);
  });

  it('joins a question that wraps onto the next line', () => {
    const { block } = run([BEGIN_END, '',
      '- ? Needs Frits [ledger n/a — his call]: **purge the plan docs from the git',
      '  HISTORY** too (they stay reachable in old commits).',
      '- the next item, not part of the question',
    ].join('\n'));
    expect(block).toMatch(/purge the plan docs from the git HISTORY too/);
    expect(block).not.toMatch(/the next item/);
  });

  it('does not scan its own block — a table that reads itself is a feedback loop, not a projection', () => {
    const { text: once } = run(BODY);
    const { text: twice } = run(once);
    expect(twice.match(/\*\*(\d+) open\*\*/)[1], 'the count does not grow by re-reading its own rows').toBe('1');
  });
});
