/**
 * A param that only a program fills is never painted in a form (ledger L1035; development red 2026-11-18).
 *
 * @guard a param declared `form: false` (a thing's reference, filled by a toolbox's choice) is not a field of any form built from an op
 *
 * Every form (web, the connected screen, the phone's op page, the page panel) is built by `buildFormSpec`; the screen's
 * form for `lists.addToList` painted the new `ref` and sent it empty, which refused every add from a screen.
 */
import { describe, it, expect } from 'vitest';
import { buildFormSpec } from '../../src/forms/buildFormSpec.js';
import { listsManifest } from '../../../lists/manifest.js';

describe('a param only a program fills is not a field', () => {
  it('addToList\'s form has no ref field (and no quantity field when it is marked so)', () => {
    const op = listsManifest.operations.find((o) => o.id === 'addToList');
    const spec = buildFormSpec({ opParams: op.params, missing: ['list', 'text'], prefilledArgs: {}, opId: 'addToList', appOrigin: 'lists' });
    const names = spec.fields.map((f) => f.name);
    expect(names).toContain('text');
    expect(names).not.toContain('ref');
  });
  it('the marker is general: any param with form: false is left out', () => {
    const spec = buildFormSpec({ opParams: [{ name: 'a', kind: 'string', required: true }, { name: 'b', kind: 'object', form: false }], missing: ['a'], prefilledArgs: {}, opId: 'x', appOrigin: 'y' });
    expect(spec.fields.map((f) => f.name)).toEqual(['a']);
  });
});
