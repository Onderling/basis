/**
 * Self-tests for lint-entry-kinds-complete — the parsers against the REAL table and manifests, the audit against
 * synthetic drift: a row without a binding, a cell missing, a vocabulary token that does not exist, an unknown kind
 * that accepts, a manifest appending to an undeclared or unaccepted lane.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { parseVocab, parseRows, parseUnknown, parseManifestLanes, audit } from './lint-entry-kinds-complete.mjs';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('packages/item-store/src/entryKinds.js');
const VOCAB = { SIGNS: parseVocab(SRC, 'SIGNS'), SUBJECT: parseVocab(SRC, 'SUBJECT'), ACCEPTS: parseVocab(SRC, 'ACCEPTS'), SYNC: parseVocab(SRC, 'SYNC') };

describe('lint-entry-kinds-complete', () => {
  it('parses the REAL table: every row has a binding, the unknown kind is local, the manifests append to declared lanes', () => {
    const rows = parseRows(SRC);
    expect(Object.keys(rows).length).toBeGreaterThanOrEqual(15);   // 16 until `roster-updated` was retired (2026-09-22)
    expect(Object.values(rows).every((b) => typeof b === 'string' && b.length)).toBe(true);
    expect(rows.membership).toMatch(/accepts: ACCEPTS\.MEMBERSHIP/);
    expect(parseUnknown(SRC)).toMatch(/LOCAL_BINDING/);
    const manifests = execSync("git ls-files 'apps/basis/src/v2/*Manifest.js'", { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const lanes = parseManifestLanes(manifests, read);
    expect(lanes.length).toBeGreaterThanOrEqual(6);
    expect(audit({ rows, unknown: parseUnknown(SRC), vocab: VOCAB, manifestLanes: lanes })).toEqual([]);
  });

  it('a row with no binding, a missing cell, or a token no vocabulary has — each is named', () => {
    const rows = {
      ok: 'CIRCLE_BINDING()',
      bare: null,
      partial: "{ signs: SIGNS.CIRCLE, subject: SUBJECT.NONE, accepts: ACCEPTS.ROSTER }",
      alien: "CIRCLE_BINDING({ accepts: ACCEPTS.MAGIC })",
    };
    const problems = audit({ rows, unknown: 'LANE.SYSTEM, false, RETAIN.SHORT, false, LOCAL_BINDING', vocab: VOCAB, manifestLanes: [] });
    expect(problems.some((p) => /'bare': no binding/.test(p))).toBe(true);
    expect(problems.some((p) => /'partial': binding lacks the 'syncPolicy' cell/.test(p))).toBe(true);
    expect(problems.some((p) => /'alien': accepts names ACCEPTS\.MAGIC/.test(p))).toBe(true);
    expect(problems.filter((p) => /'ok'/.test(p))).toEqual([]);
  });

  it('an unknown kind that would accept something is a problem', () => {
    const problems = audit({ rows: {}, unknown: 'LANE.SYSTEM, false, RETAIN.SHORT, false, CIRCLE_BINDING()', vocab: VOCAB, manifestLanes: [] });
    expect(problems[0]).toMatch(/UNKNOWN_KIND: must be the local binding/);
  });

  it('a manifest appending to an undeclared lane, or to a lane that accepts nothing, is a problem', () => {
    const rows = { chat: 'CIRCLE_BINDING()', note: 'LOCAL_BINDING' };
    const problems = audit({ rows, unknown: 'x, LOCAL_BINDING', vocab: VOCAB, manifestLanes: [
      { file: 'a.js', laneConst: 'A_LANE', lane: 'chat' },
      { file: 'b.js', laneConst: 'B_LANE', lane: 'ghost' },
      { file: 'c.js', laneConst: 'C_LANE', lane: 'note' },
      { file: 'd.js', laneConst: 'D_LANE', lane: null },
    ] });
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/b\.js: appends to lane 'ghost', which is not a declared/),
      expect.stringMatching(/c\.js: appends to lane 'note', whose kind accepts nothing/),
      expect.stringMatching(/d\.js: appends to D_LANE, which that manifest does not define/),
    ]));
    expect(problems).toHaveLength(3);
    expect(problems.filter((p) => /a\.js/.test(p))).toEqual([]);
  });
});
