import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  VERBS,
  isCanonicalVerb,
  classifyItemTypes,
  isRegistryType,
} from '../src/index.js';

const ok = (m) => validateManifest(m).ok;
const errs = (m) => validateManifest(m).errors;

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    expect(ok({
      app:        'a',
      itemTypes:  ['task'],
      operations: [{ id: 'addTask', verb: 'add', params: [] }],
    })).toBe(true);
  });

  it('app must be a non-empty string', () => {
    expect(errs({ app: '', itemTypes: [], operations: [] })).toContainEqual(
      expect.objectContaining({ path: '/app' }),
    );
  });

  it('itemTypes must be an array', () => {
    expect(errs({ app: 'a', itemTypes: 'not array', operations: [] })).toContainEqual(
      expect.objectContaining({ path: '/itemTypes' }),
    );
  });

  it('duplicate itemTypes rejected', () => {
    const e = errs({ app: 'a', itemTypes: ['x', 'x'], operations: [] });
    expect(e.some((x) => /duplicate/.test(x.message))).toBe(true);
  });

  it('operations must be an array', () => {
    expect(errs({ app: 'a', itemTypes: [] })).toContainEqual(
      expect.objectContaining({ path: '/operations' }),
    );
  });

  it('F-SP1-e: verb must be a non-empty string; non-canonical strings are permitted', () => {
    // Empty / non-string rejected.
    const empty = errs({
      app: 'a', itemTypes: [],
      operations: [{ id: 'op', verb: '', params: [] }],
    });
    expect(empty.some((x) => x.path.endsWith('/verb'))).toBe(true);
    const nonString = errs({
      app: 'a', itemTypes: [],
      operations: [{ id: 'op', verb: 42 }],
    });
    expect(nonString.some((x) => x.path.endsWith('/verb'))).toBe(true);
    // Non-canonical strings PERMITTED (app-specific verbs like `help` /
    // `nope` / `meta`).  isCanonicalVerb() stays for the strict ItemStore check.
    expect(ok({ app:'a', itemTypes:[],
      operations:[{id:'op', verb:'help'}] })).toBe(true);
    expect(ok({ app:'a', itemTypes:[],
      operations:[{id:'op', verb:'nope'}] })).toBe(true);
  });

  it('F-SP1-d: manifest.systemPrompt (string) is accepted', () => {
    expect(ok({
      app: 'a', itemTypes: [],
      operations: [{ id: 'op', verb: 'add' }],
      systemPrompt: 'You are X.\n\nYou do Y.',
    })).toBe(true);
  });

  it('duplicate operation id rejected', () => {
    const e = errs({
      app: 'a', itemTypes: ['task'],
      operations: [
        { id: 'op', verb: 'add' },
        { id: 'op', verb: 'remove' },
      ],
    });
    expect(e.some((x) => /duplicate/.test(x.message) && /operation id/.test(x.message))).toBe(true);
  });

  it('F-SP1-a: app-local (non-canonical) item types are PERMITTED', () => {
    // household's fixed enum is not in @onderling/item-types canonical set;
    // validateManifest must still pass.
    expect(ok({
      app:        'household',
      itemTypes:  ['shopping', 'errand', 'repair', 'schedule'],
      operations: [
        { id: 'addItem',  verb: 'add',
          params: [
            { name: 'type', kind: 'enum', of: 'itemTypes', required: true },
            { name: 'text', kind: 'string', required: true },
          ],
        },
      ],
    })).toBe(true);
  });

  it("param.kind='enum' without 'of' rejected", () => {
    const e = errs({
      app: 'a', itemTypes: [],
      operations: [{
        id: 'op', verb: 'add',
        params: [{ name: 'x', kind: 'enum' }],
      }],
    });
    expect(e.some((x) => /requires 'of'/.test(x.message))).toBe(true);
  });

  it('unknown param kind rejected', () => {
    const e = errs({
      app: 'a', itemTypes: [],
      operations: [{
        id: 'op', verb: 'add',
        params: [{ name: 'x', kind: 'blob' }],
      }],
    });
    expect(e.some((x) => /kind must be/.test(x.message))).toBe(true);
  });

  it('appliesTo.type must reference manifest.itemTypes', () => {
    const e = errs({
      app: 'a', itemTypes: ['task'],
      operations: [{
        id: 'op', verb: 'claim',
        appliesTo: { type: 'unknown' },
      }],
    });
    expect(e.some((x) => /not in manifest.itemTypes/.test(x.message))).toBe(true);
  });

  // Completeness parity with appliesTo.type: an op may name its noun EITHER via
  // appliesTo.type OR via a `type`-named enum param whose inline `of` lists the
  // item types (the opNouns convention). appliesTo.type is cross-checked against
  // manifest.itemTypes; the symmetric `type`-enum param must be too — else a
  // noun that isn't a declared itemType slips through silently.
  it("a `type`-enum param's inline `of` must reference manifest.itemTypes", () => {
    const e = errs({
      app: 'a', itemTypes: ['task'],
      operations: [{
        id: 'addItem', verb: 'add',
        params: [
          { name: 'type', kind: 'enum', of: ['task', 'bogus'], required: true },
          { name: 'text', kind: 'string', required: true },
        ],
      }],
    });
    expect(e.some((x) => /"bogus"/.test(x.message) && /not in manifest.itemTypes/.test(x.message))).toBe(true);
  });

  it("a `type`-enum param whose inline `of` is all declared itemTypes passes", () => {
    expect(ok({
      app: 'a', itemTypes: ['task', 'note'],
      operations: [{
        id: 'addItem', verb: 'add',
        params: [
          { name: 'type', kind: 'enum', of: ['task', 'note'], required: true },
          { name: 'text', kind: 'string', required: true },
        ],
      }],
    })).toBe(true);
  });

  it("a value-enum param named other than `type` is NOT cross-checked against itemTypes", () => {
    // mode/action/lang enums list option VALUES, not nouns — they must never be
    // forced to be itemTypes (regression guard for the scoped fix).
    expect(ok({
      app: 'a', itemTypes: ['task'],
      operations: [{
        id: 'setMode', verb: 'add',
        params: [{ name: 'mode', kind: 'enum', of: ['nkn', 'relay', 'both'], required: true }],
      }],
    })).toBe(true);
  });

  it('views: duplicate id + bad type rejected', () => {
    const e = errs({
      app: 'a', itemTypes: ['task'],
      operations: [{ id: 'op', verb: 'add' }],
      views: [
        { id: 'v', title: 'V1', type: 'task' },
        { id: 'v', title: 'V2', type: 'bogus' },
      ],
    });
    expect(e.some((x) => /duplicate/.test(x.message))).toBe(true);
    expect(e.some((x) => /not in manifest.itemTypes/.test(x.message))).toBe(true);
  });

  it('tolerates unknown top-level / op keys (forward-additive)', () => {
    expect(ok({
      app: 'a',
      itemTypes: ['task'],
      operations: [{ id: 'op', verb: 'add', futureField: 42 }],
      requires:  { storage: 'pod' },                   // accepted-not-interpreted
      somethingNew: { foo: 'bar' },
    })).toBe(true);
  });

  /* ─── — view extensions ─────────────────────────── */

  describe('V0.3 Q17 view.shape', () => {
    const base = (overrides) => ({
      app: 'a',
      itemTypes: ['task'],
      operations: [],
      views: [{ id: 'v', title: 'V', type: 'task', ...overrides }],
    });

    it('accepts view.shape === "list" (explicit)', () => {
      expect(ok(base({ shape: 'list' }))).toBe(true);
    });

    it('accepts view.shape === "record"', () => {
      expect(ok(base({ shape: 'record' }))).toBe(true);
    });

    it('accepts view without shape (implicit "list")', () => {
      expect(ok(base({}))).toBe(true);
    });

    it('rejects view.shape with an unknown value', () => {
      const e = errs(base({ shape: 'grid' }));
      expect(e.some((x) => /must be 'list' or 'record'/.test(x.message))).toBe(true);
    });
  });

  describe('D-mig-1a view.labelField + view.categoryField', () => {
    const base = (overrides) => ({
      app: 'a',
      itemTypes: ['task'],
      operations: [],
      views: [{ id: 'v', title: 'V', type: 'task', ...overrides }],
    });

    it('accepts string labelField + categoryField', () => {
      expect(ok(base({ labelField: 'label', categoryField: 'kind' }))).toBe(true);
    });

    it('accepts a view without labelField/categoryField (back-compatible)', () => {
      expect(ok(base({}))).toBe(true);
    });

    it('rejects a non-string labelField', () => {
      const e = errs(base({ labelField: 123 }));
      expect(e.some((x) => /view.labelField must be a string/.test(x.message))).toBe(true);
    });

    it('rejects a non-string categoryField', () => {
      const e = errs(base({ categoryField: { field: 'kind' } }));
      expect(e.some((x) => /view.categoryField must be a string/.test(x.message))).toBe(true);
    });
  });

  describe('D-mig-2 view.searchFields', () => {
    const base = (overrides) => ({
      app: 'a',
      itemTypes: ['task'],
      operations: [],
      views: [{ id: 'v', title: 'V', type: 'task', ...overrides }],
    });

    it('accepts a string[] searchFields', () => {
      expect(ok(base({ searchFields: ['label', 'handle'] }))).toBe(true);
    });

    it('accepts a view without searchFields (back-compatible → default [labelField])', () => {
      expect(ok(base({}))).toBe(true);
    });

    it('rejects a non-array searchFields', () => {
      const e = errs(base({ searchFields: 'label' }));
      expect(e.some((x) => /view.searchFields must be an array of strings/.test(x.message))).toBe(true);
    });

    it('rejects a searchFields with a non-string entry', () => {
      const e = errs(base({ searchFields: ['label', 123] }));
      expect(e.some((x) => /view.searchFields entries must be non-empty strings/.test(x.message))).toBe(true);
    });
  });

  describe('V0.3 Q15/Q16 dataSource sanity check', () => {
    const base = (dataSource) => ({
      app: 'a',
      itemTypes: ['task'],
      operations: [],
      views: [{ id: 'v', title: 'V', type: 'task', dataSource }],
    });

    it('accepts dataSource with skillId', () => {
      expect(ok(base({ skillId: 'listOpen' }))).toBe(true);
    });

    it('accepts dataSource with skillId + args + argsFromContext', () => {
      expect(ok(base({
        skillId: 'getPrivacyNotice',
        args:            { limit: 10 },
        argsFromContext: { lang: '$lang' },
      }))).toBe(true);
    });

    it('rejects dataSource without skillId', () => {
      const e = errs(base({ args: { x: 1 } }));
      expect(e.some((x) => /skillId must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('rejects dataSource that is not an object', () => {
      const e = errs(base('listOpen'));
      expect(e.some((x) => /must be an object/.test(x.message))).toBe(true);
    });

    it('rejects argsFromContext that is not an object', () => {
      const e = errs(base({ skillId: 'x', argsFromContext: ['lang'] }));
      expect(e.some((x) => /argsFromContext must be an object/.test(x.message))).toBe(true);
    });
  });

  /* ─── — view.fields + strict mode ─────────────────────────── */

  describe('V0.4 Q18 view.fields', () => {
    const base = (overrides) => ({
      app: 'a',
      itemTypes: ['rec'],
      operations: [{ id: 'updateRec', verb: 'update' }],
      views: [{
        id: 'r', title: 'R', type: 'rec', shape: 'record', ...overrides,
      }],
    });

    it('accepts well-formed view.fields[] with patch declarations', () => {
      expect(ok(base({
        fields: [
          { name: 'language', type: 'enum',
            patch: { opId: 'updateRec', argName: 'language' } },
          { name: 'readonlyField', type: 'string' },
        ],
      }))).toBe(true);
    });

    it('rejects view.fields when view.shape !== "record"', () => {
      const e = errs({
        app: 'a',
        itemTypes: ['rec'],
        operations: [],
        views: [{
          id: 'r', title: 'R', type: 'rec',  // shape NOT 'record'
          fields: [{ name: 'x' }],
        }],
      });
      expect(e.some((x) => /only meaningful when view\.shape === 'record'/.test(x.message))).toBe(true);
    });

    it('rejects fields without name', () => {
      const e = errs(base({ fields: [{ type: 'string' }] }));
      expect(e.some((x) => /field\.name must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('rejects field.patch missing opId', () => {
      const e = errs(base({ fields: [{ name: 'x', patch: { argName: 'x' } }] }));
      expect(e.some((x) => /field\.patch\.opId must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('rejects field.patch missing argName', () => {
      const e = errs(base({ fields: [{ name: 'x', patch: { opId: 'updateRec' } }] }));
      expect(e.some((x) => /field\.patch\.argName must be a non-empty string/.test(x.message))).toBe(true);
    });

    /* ─── (2026-05-22) — patch.argWrapper ─────────────────── */

    it('Q21 — accepts patch.argWrapper as a non-empty string', () => {
      expect(ok(base({
        fields: [
          { name: 'pollIntervalMs', type: 'number',
            patch: { opId: 'updateRec', argName: 'pollIntervalMs',
                     argWrapper: 'patch' } },
        ],
      }))).toBe(true);
    });

    it('Q21 — rejects empty-string patch.argWrapper', () => {
      const e = errs(base({
        fields: [
          { name: 'x', patch: { opId: 'updateRec', argName: 'x', argWrapper: '' } },
        ],
      }));
      expect(e.some((x) => /field\.patch\.argWrapper must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('Q21 — rejects non-string patch.argWrapper', () => {
      const e = errs(base({
        fields: [
          { name: 'x', patch: { opId: 'updateRec', argName: 'x', argWrapper: 42 } },
        ],
      }));
      expect(e.some((x) => /field\.patch\.argWrapper must be a non-empty string/.test(x.message))).toBe(true);
    });

    /* ─── (2026-05-20) — field.labelKey ────────────────────── */

    it('Q22 — accepts field.labelKey as a non-empty string', () => {
      expect(ok(base({
        fields: [
          { name: 'language', type: 'enum', label: 'Taal',
            labelKey: 'settings.language' },
        ],
      }))).toBe(true);
    });

    it('Q22 — rejects empty-string field.labelKey', () => {
      const e = errs(base({
        fields: [{ name: 'x', labelKey: '' }],
      }));
      expect(e.some((x) => /field\.labelKey must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('Q22 — rejects non-string field.labelKey', () => {
      const e = errs(base({
        fields: [{ name: 'x', labelKey: 42 }],
      }));
      expect(e.some((x) => /field\.labelKey must be a non-empty string/.test(x.message))).toBe(true);
    });

    /* ─── (2026-05-20) — field.type file / image ───────────── */

    it("Q23 — accepts field.type: 'image'", () => {
      expect(ok(base({
        fields: [{ name: 'avatar', type: 'image' }],
      }))).toBe(true);
    });

    it("Q23 — accepts field.type: 'file'", () => {
      expect(ok(base({
        fields: [{ name: 'doc', type: 'file' }],
      }))).toBe(true);
    });

    it('Q23 — accepts unknown field.type strings (lax — projector passes through)', () => {
      // Forward-additive: substrate doesn't gate-keep field types so
      // consumers may experiment with new shapes before they're
      // codified.  Unknown types still pass validation.
      expect(ok(base({
        fields: [{ name: 'x', type: 'experimental-rich-text' }],
      }))).toBe(true);
    });

    it('Q23 — rejects non-string field.type', () => {
      const e = errs(base({
        fields: [{ name: 'x', type: 42 }],
      }));
      expect(e.some((x) => /field\.type must be a string/.test(x.message))).toBe(true);
    });

    /* ─── (2026-05-20) — field.readSkill ───────────────────── */

    it('Q25 — accepts field.readSkill with non-empty skillId', () => {
      expect(ok(base({
        fields: [{ name: 'holidayMode', type: 'boolean',
                   readSkill: { skillId: 'getHolidayMode' } }],
      }))).toBe(true);
    });

    it('Q25 — accepts field.readSkill with args object', () => {
      expect(ok(base({
        fields: [{ name: 'lang', type: 'string',
                   readSkill: { skillId: 'getLang', args: { locale: 'nl' } } }],
      }))).toBe(true);
    });

    it('Q25 — rejects field.readSkill as a non-object', () => {
      const e = errs(base({
        fields: [{ name: 'x', readSkill: 'getX' }],
      }));
      expect(e.some((x) => /field\.readSkill must be an object/.test(x.message))).toBe(true);
    });

    it('Q25 — rejects field.readSkill missing skillId', () => {
      const e = errs(base({
        fields: [{ name: 'x', readSkill: { args: {} } }],
      }));
      expect(e.some((x) => /field\.readSkill\.skillId must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('Q25 — rejects field.readSkill.args as non-object', () => {
      const e = errs(base({
        fields: [{ name: 'x', readSkill: { skillId: 'getX', args: 'oops' } }],
      }));
      expect(e.some((x) => /field\.readSkill\.args must be an object/.test(x.message))).toBe(true);
    });

    /* ─── (2026-05-20) — field.requiresField ──────────────── */

    it('Q26 — accepts single-value requiresField gate', () => {
      expect(ok(base({
        fields: [{ name: 'groupPodUri',
                   requiresField: { policy: 'centralised' } }],
      }))).toBe(true);
    });

    it('Q26 — accepts array-value requiresField gate', () => {
      expect(ok(base({
        fields: [{ name: 'groupPodUri',
                   requiresField: { policy: ['centralised', 'hybrid'] } }],
      }))).toBe(true);
    });

    it('Q26 — rejects requiresField as a non-object', () => {
      const e = errs(base({
        fields: [{ name: 'x', requiresField: 'policy' }],
      }));
      expect(e.some((x) => /field\.requiresField must be an object/.test(x.message))).toBe(true);
    });

    it('Q26 — rejects empty requiresField object', () => {
      const e = errs(base({
        fields: [{ name: 'x', requiresField: {} }],
      }));
      expect(e.some((x) => /field\.requiresField must have at least one key/.test(x.message))).toBe(true);
    });
  });

  describe('V0.6 Q22 surfaces.ui.labelKey on operations', () => {
    const baseManifest = (op) => ({
      app:        'i',
      itemTypes:  ['t'],
      operations: [op],
      views:      [{ id: 'v', title: 'V', type: 't' }],
    });

    it('Q22 — accepts surfaces.ui.labelKey as a non-empty string', () => {
      expect(ok(baseManifest({
        id: 'doIt', verb: 'do', params: [],
        surfaces: { ui: { label: 'Do it', labelKey: 'op.do' } },
      }))).toBe(true);
    });

    it('Q22 — rejects empty-string surfaces.ui.labelKey', () => {
      const e = errs(baseManifest({
        id: 'doIt', verb: 'do', params: [],
        surfaces: { ui: { label: 'Do it', labelKey: '' } },
      }));
      expect(e.some((x) => /surfaces\.ui\.labelKey must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('Q22 — rejects non-string surfaces.ui.labelKey', () => {
      const e = errs(baseManifest({
        id: 'doIt', verb: 'do', params: [],
        surfaces: { ui: { label: 'Do it', labelKey: 99 } },
      }));
      expect(e.some((x) => /surfaces\.ui\.labelKey must be a non-empty string/.test(x.message))).toBe(true);
    });
  });

  describe('op.stepUp — a call from a screen runs only after a yes in the private chat', () => {
    const m = (op) => ({ app: 'c', itemTypes: ['t'], operations: [op], views: [{ id: 'v', title: 'V', type: 't' }] });
    it('accepts private-door', () => {
      expect(ok(m({ id: 'doIt', verb: 'do', params: [], stepUp: 'private-door' }))).toBe(true);
    });
    it('rejects any other value', () => {
      const e = errs(m({ id: 'doIt', verb: 'do', params: [], stepUp: 'sometimes' }));
      expect(e.some((x) => /op\.stepUp must be 'private-door'/.test(x.message))).toBe(true);
    });
  });

  describe('V0.8 Q27 surfaces.ui.confirm severity hint', () => {
    const baseManifest = (op) => ({
      app:        'c',
      itemTypes:  ['t'],
      operations: [op],
      views:      [{ id: 'v', title: 'V', type: 't' }],
    });

    it("Q27 — accepts confirm with severity: 'danger' + message", () => {
      expect(ok(baseManifest({
        id: 'rm', verb: 'remove', params: [],
        appliesTo: { type: 't' },
        surfaces: { ui: { label: 'Delete',
                          confirm: { severity: 'danger', message: 'Are you sure?' } } },
      }))).toBe(true);
    });

    it('Q27 — accepts confirm with severity only (no message)', () => {
      expect(ok(baseManifest({
        id: 'arch', verb: 'archive', params: [],
        appliesTo: { type: 't' },
        surfaces: { ui: { label: 'Archive',
                          confirm: { severity: 'warn' } } },
      }))).toBe(true);
    });

    it("Q27 — rejects unknown severity value", () => {
      const e = errs(baseManifest({
        id: 'x', verb: 'do', params: [],
        appliesTo: { type: 't' },
        surfaces: { ui: { confirm: { severity: 'critical' } } },
      }));
      expect(e.some((x) => /severity must be 'info' \| 'warn' \| 'danger'/.test(x.message))).toBe(true);
    });

    it('Q27 — rejects confirm as non-object', () => {
      const e = errs(baseManifest({
        id: 'x', verb: 'do', params: [],
        appliesTo: { type: 't' },
        surfaces: { ui: { confirm: 'danger' } },
      }));
      expect(e.some((x) => /confirm must be an object/.test(x.message))).toBe(true);
    });

    it('Q27 — rejects empty-string confirm.message', () => {
      const e = errs(baseManifest({
        id: 'x', verb: 'do', params: [],
        appliesTo: { type: 't' },
        surfaces: { ui: { confirm: { severity: 'warn', message: '' } } },
      }));
      expect(e.some((x) => /confirm\.message must be a non-empty string/.test(x.message))).toBe(true);
    });
  });

  describe('basis v0.1 Q28 surfaces.chat.reply', () => {
    const baseManifest = (op) => ({
      app:        'c',
      itemTypes:  ['t'],
      operations: [op],
      views:      [{ id: 'v', title: 'V', type: 't' }],
    });
    const shapes = [
      'text', 'list', 'record', 'mini-page',
      'file', 'embed-card', 'notification', 'brief',
    ];

    it.each(shapes)('Q28 — accepts reply: %s', (shape) => {
      expect(ok(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { reply: shape } },
      }))).toBe(true);
    });

    it('Q28 — accepts absent reply (forward-additive default)', () => {
      expect(ok(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { hint: 'no reply field declared' } },
      }))).toBe(true);
    });

    it('Q28 — rejects unknown reply value', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { reply: 'carousel' } },
      }));
      expect(e.some((x) => /reply must be one of/.test(x.message))).toBe(true);
      expect(e.some((x) => /'text'/.test(x.message))).toBe(true);
      expect(e.some((x) => /'brief'/.test(x.message))).toBe(true);
    });

    it('Q28 — rejects non-string reply value', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { reply: 42 } },
      }));
      expect(e.some((x) => /reply must be one of/.test(x.message))).toBe(true);
    });
  });

  describe('basis v0.4 Q31 surfaces.chat.followUps', () => {
    const baseManifest = (op) => ({
      app:        'c',
      itemTypes:  ['t'],
      operations: [op],
      views:      [{ id: 'v', title: 'V', type: 't' }],
    });

    it('Q31 — accepts followUps as an array of {opId, prefilledArgs?}', () => {
      expect(ok(baseManifest({
        id: 'addMember', verb: 'add', params: [],
        surfaces: { chat: { followUps: [
          { opId: 'shareFolder' },
          { opId: 'addTask', prefilledArgs: { for: 'newMember' } },
        ] } },
      }))).toBe(true);
    });

    it('Q31 — accepts absent followUps (forward-additive)', () => {
      expect(ok(baseManifest({
        id: 'addMember', verb: 'add', params: [],
        surfaces: { chat: { hint: 'no followups' } },
      }))).toBe(true);
    });

    it('Q31 — accepts empty array', () => {
      expect(ok(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { followUps: [] } },
      }))).toBe(true);
    });

    it('Q31 — rejects non-array', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { followUps: 'not-array' } },
      }));
      expect(e.some((x) => /followUps must be an array/.test(x.message))).toBe(true);
    });

    it('Q31 — rejects entry with missing opId', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { followUps: [{ prefilledArgs: { x: 1 } }] } },
      }));
      expect(e.some((x) => /opId must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('Q31 — rejects non-object entry', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { followUps: ['not-object'] } },
      }));
      expect(e.some((x) => /followUp entry must be an object/.test(x.message))).toBe(true);
    });

    it('Q31 — rejects non-object prefilledArgs', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { followUps: [{ opId: 'x', prefilledArgs: 'wrong' }] } },
      }));
      expect(e.some((x) => /prefilledArgs must be an object/.test(x.message))).toBe(true);
    });
  });

  describe('basis v0.5 Q29 surfaces.chat.embed', () => {
    const baseManifest = (op) => ({
      app:        'c',
      itemTypes:  ['t'],
      operations: [op],
      views:      [{ id: 'v', title: 'V', type: 't' }],
    });

    it('Q29 — accepts cardSnapshotSkill: string', () => {
      expect(ok(baseManifest({
        id: 'markComplete', verb: 'complete', params: [],
        surfaces: { chat: { embed: { cardSnapshotSkill: 'getSnapshot' } } },
      }))).toBe(true);
    });

    it('Q29 — accepts absent embed (forward-additive)', () => {
      expect(ok(baseManifest({
        id: 'op', verb: 'do', params: [],
      }))).toBe(true);
    });

    it('Q29 — rejects non-object embed', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { embed: 'wrong' } },
      }));
      expect(e.some((x) => /embed must be an object/.test(x.message))).toBe(true);
    });

    it('Q29 — rejects missing cardSnapshotSkill', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { embed: {} } },
      }));
      expect(e.some((x) => /cardSnapshotSkill must be a non-empty string/.test(x.message))).toBe(true);
    });

    it('Q29 — rejects empty cardSnapshotSkill', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [],
        surfaces: { chat: { embed: { cardSnapshotSkill: '' } } },
      }));
      expect(e.some((x) => /cardSnapshotSkill must be a non-empty string/.test(x.message))).toBe(true);
    });
  });

  describe('basis v0.4 Q32 op.runtime', () => {
    const baseManifest = (op) => ({
      app:        'c',
      itemTypes:  ['t'],
      operations: [op],
      views:      [{ id: 'v', title: 'V', type: 't' }],
    });

    it.each(['browser', 'node', 'both'])('Q32 — accepts runtime: %s', (val) => {
      expect(ok(baseManifest({
        id: 'op', verb: 'do', params: [], runtime: val,
      }))).toBe(true);
    });

    it('Q32 — accepts absent runtime (forward-additive)', () => {
      expect(ok(baseManifest({
        id: 'op', verb: 'do', params: [],
      }))).toBe(true);
    });

    it('Q32 — rejects unknown value', () => {
      const e = errs(baseManifest({
        id: 'op', verb: 'do', params: [], runtime: 'wasm',
      }));
      expect(e.some((x) => /runtime must be one of/.test(x.message))).toBe(true);
    });
  });

  describe('V0.4 Q16-strict mode', () => {
    const strict = (m) => validateManifest(m, { strict: true });
    const lax    = (m) => validateManifest(m);

    const MANIFEST_TYPO = {
      app: 'a',
      itemTypes: ['t'],
      operations: [{ id: 'listKnown', verb: 'list' }],
      views: [{
        id: 'v', title: 'V', type: 't',
        dataSource: { skillId: 'listMisspelled' },  // typo
      }],
    };

    it('lax mode allows unknown skillId (existing behaviour)', () => {
      expect(lax(MANIFEST_TYPO).ok).toBe(true);
    });

    it('strict mode REJECTS unknown skillId', () => {
      const r = strict(MANIFEST_TYPO);
      expect(r.ok).toBe(false);
      expect(r.errors.some((x) =>
        x.code === 'unknown-skillId' && /listMisspelled/.test(x.message))).toBe(true);
    });

    it('strict mode accepts skillId from operations[].id', () => {
      const r = strict({
        app: 'a',
        itemTypes: ['t'],
        operations: [{ id: 'listKnown', verb: 'list' }],
        views: [{ id: 'v', title: 'V', type: 't',
                  dataSource: { skillId: 'listKnown' } }],
      });
      expect(r.ok).toBe(true);
    });

    it('strict mode accepts skillId from externalSkills allow-list', () => {
      const r = strict({
        app: 'a',
        itemTypes: ['t'],
        externalSkills: ['listExternal'],
        operations: [],
        views: [{ id: 'v', title: 'V', type: 't',
                  dataSource: { skillId: 'listExternal' } }],
      });
      expect(r.ok).toBe(true);
    });

    it('strict mode ALSO checks Q18 field.patch.opId', () => {
      const r = strict({
        app: 'a',
        itemTypes: ['rec'],
        operations: [],
        views: [{
          id: 'r', title: 'R', type: 'rec', shape: 'record',
          dataSource: { skillId: 'getRec' },           // would also be unknown
          externalSkills: undefined,
          fields: [{ name: 'x', patch: { opId: 'updateMisspelled', argName: 'x' } }],
        }],
        externalSkills: ['getRec'],   // allow getRec
      });
      expect(r.ok).toBe(false);
      expect(r.errors.some((x) =>
        x.code === 'unknown-skillId' && /updateMisspelled/.test(x.message))).toBe(true);
    });

    it('externalSkills must be an array of strings', () => {
      const e = errs({
        app: 'a', itemTypes: [], operations: [],
        externalSkills: 'listA,listB',
      });
      expect(e.some((x) => /externalSkills must be an array/.test(x.message))).toBe(true);
    });
  });
});

describe('#180 — surfaces.page slot (2026-05-24)', () => {
  const okBase = { app: 'a', itemTypes: ['t'], operations: [], views: [] };

  it("accepts surfaces.page with kind 'side-panel'", () => {
    const e = errs({
      ...okBase,
      operations: [{
        id: 'openSettings', verb: 'list',
        surfaces: { page: { kind: 'side-panel', title: 'Settings' } },
      }],
    });
    expect(e).toEqual([]);
  });

  it("accepts surfaces.page with kind 'modal' + 'screen'", () => {
    expect(errs({ ...okBase, operations: [{
      id: 'm', verb: 'list', surfaces: { page: { kind: 'modal' } },
    }] })).toEqual([]);
    expect(errs({ ...okBase, operations: [{
      id: 's', verb: 'list', surfaces: { page: { kind: 'screen', route: '/settings' } },
    }] })).toEqual([]);
  });

  it('rejects surfaces.page without kind', () => {
    const e = errs({ ...okBase, operations: [{
      id: 'o', verb: 'list', surfaces: { page: { title: 'oops' } },
    }] });
    expect(e.some((x) => /surfaces\/page\/kind/.test(x.path))).toBe(true);
  });

  it('rejects unknown kind', () => {
    const e = errs({ ...okBase, operations: [{
      id: 'o', verb: 'list', surfaces: { page: { kind: 'overlay' } },
    }] });
    expect(e.some((x) => /side-panel/.test(x.message))).toBe(true);
  });

  it('rejects empty title / route strings', () => {
    expect(errs({ ...okBase, operations: [{
      id: 'o', verb: 'list', surfaces: { page: { kind: 'modal', title: '' } },
    }] }).some((x) => /title/.test(x.path))).toBe(true);
    expect(errs({ ...okBase, operations: [{
      id: 'o', verb: 'list', surfaces: { page: { kind: 'screen', route: '' } },
    }] }).some((x) => /route/.test(x.path))).toBe(true);
  });

  it('rejects non-object surfaces.page', () => {
    const e = errs({ ...okBase, operations: [{
      id: 'o', verb: 'list', surfaces: { page: 'side-panel' },
    }] });
    expect(e.some((x) => /must be an object/.test(x.message))).toBe(true);
  });
});

describe('VERBS / isCanonicalVerb', () => {
  it('frozen verb allow-list mirrors item-store', () => {
    for (const v of ['add', 'list', 'complete', 'remove', 'claim', 'reassign', 'submit', 'approve', 'reject', 'revoke']) {
      expect(VERBS).toContain(v);
      expect(isCanonicalVerb(v)).toBe(true);
    }
    expect(isCanonicalVerb('bogus')).toBe(false);
    // VERBS must be frozen.
    expect(() => { VERBS.push('hack'); }).toThrow();
  });
});

describe('classifyItemTypes', () => {
  it("splits canonical (from @onderling/item-types list()) vs app-local", () => {
    const { canonical, appLocal } = classifyItemTypes({
      itemTypes: ['task', 'note', 'shopping', 'errand'],
    });
    expect(canonical).toEqual(expect.arrayContaining(['task', 'note']));
    expect(appLocal).toEqual(expect.arrayContaining(['shopping', 'errand']));
    expect(canonical).not.toContain('shopping');
    expect(appLocal).not.toContain('task');
  });
});

describe('L4 ≡ B — nouns converge with the @onderling/item-types registry', () => {
  const M = (itemTypes, extra = {}) => ({
    app: 'a',
    itemTypes,
    operations: [{ id: 'x', verb: 'add', params: [] }],
    ...extra,
  });

  describe('isRegistryType', () => {
    it('recognises canonical types', () => {
      expect(isRegistryType('task')).toBe(true);
      expect(isRegistryType('calendar-event')).toBe(true);
    });
    it('recognises legacy aliases (alias-aware)', () => {
      // supply-offer/demand-offer/lend-request are registry aliases (canonical.js).
      expect(isRegistryType('supply-offer')).toBe(true);
    });
    it('rejects app-local / unknown / malformed names', () => {
      expect(isRegistryType('shopping')).toBe(false);
      expect(isRegistryType('')).toBe(false);
      expect(isRegistryType(undefined)).toBe(false);
    });
  });

  it('result always carries a warnings array (forward-additive)', () => {
    const r = validateManifest(M(['task']));
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('canonical + alias itemTypes produce NO registry warning', () => {
    expect(validateManifest(M(['task', 'note', 'supply-offer'])).warnings).toEqual([]);
  });

  it('a registry-unknown itemType is a non-blocking WARNING by default (F-SP1-a)', () => {
    const r = validateManifest(M(['task', 'shopping']));
    expect(r.ok).toBe(true);                 // still valid — app-local types keep working
    expect(r.errors).toEqual([]);
    const w = r.warnings.find((x) => x.code === 'noncanonical-itemtype');
    expect(w).toBeTruthy();
    expect(w.path).toBe('/itemTypes/1');
    expect(w.message).toMatch(/shopping/);
  });

  it('strictNouns turns the same finding into a hard ERROR (default-deny)', () => {
    const r = validateManifest(M(['task', 'shopping']), { strictNouns: true });
    expect(r.ok).toBe(false);
    expect(r.warnings).toEqual([]);          // moved to errors
    const e = r.errors.find((x) => x.code === 'noncanonical-itemtype');
    expect(e).toBeTruthy();
    expect(e.path).toBe('/itemTypes/1');
  });

  it('strictNouns still accepts an all-registry surface', () => {
    const r = validateManifest(M(['task', 'note', 'contact']), { strictNouns: true });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('registry warning does not double-fire with structural errors', () => {
    // duplicate app-local itemType: one duplicate error + one registry warning per distinct string.
    const r = validateManifest(M(['shopping', 'shopping']));
    expect(r.errors.some((x) => /duplicate/.test(x.message))).toBe(true);
    expect(r.warnings.filter((x) => x.code === 'noncanonical-itemtype')).toHaveLength(1);
  });
});

describe('B · Layer 1 — domainVerbs map shape: each domain verb classified read or write', () => {
  const M = (domainVerbs) => ({
    app: 'a',
    itemTypes: ['task'],
    operations: [{ id: 'addTask', verb: 'add', params: [] }],
    domainVerbs,
  });

  it('accepts a map of non-atom domain verbs, each read or write', () => {
    // `help`/`register` don't reduce to an atom — the legitimate ~20% domain tail.
    expect(validateManifest(M({ help: 'read', register: 'write' })).ok).toBe(true);
    expect(validateManifest(M({})).ok).toBe(true);
  });

  it('absent domainVerbs is fine (forward-additive)', () => {
    const { domainVerbs, ...rest } = M({ help: 'read' });   // eslint-disable-line no-unused-vars
    expect(validateManifest(rest).ok).toBe(true);
  });

  it('rejects a list or a string — a list says nothing about reading or writing', () => {
    for (const bad of [['help'], 'help']) {
      const { errors, ok } = validateManifest(M(bad));
      expect(ok).toBe(false);
      expect(errors.some((e) => e.path === '/domainVerbs')).toBe(true);
    }
  });

  it('rejects a verb that is not classified read or write', () => {
    for (const bad of [true, 'writes', null]) {
      const r = validateManifest(M({ register: bad }));
      expect(r.errors.some((e) => e.path === '/domainVerbs/register' && e.code === 'unclassified-domain-verb')).toBe(true);
    }
  });

  it('rejects an SDK atom (or alias) declared as a domain verb — use the atom directly', () => {
    // Fitness guard: `remove` is a canonical atom; `create` is an alias of `add`.
    expect(validateManifest(M({ remove: 'write' })).errors.some((e) => e.code === 'atom-in-domain-verbs')).toBe(true);
    expect(validateManifest(M({ create: 'write' })).errors.some((e) => e.code === 'atom-in-domain-verbs')).toBe(true);
  });
});
