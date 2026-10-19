import { describe, it, expect } from 'vitest';
import {
  renderAttachments,
  encodeGenericOpId,
  renderChat,
  renderCoverage,
  AFFORDANCE_PROJECTORS,
  SHELL_PROJECTORS,
} from '../src/index.js';

// A basis-shaped fixture: two attach ops (one also slash), one slash-only op,
// one op with no attach surface at all.
const manifest = {
  app: 'demo',
  itemTypes: ['media', 'calendar-event', 'task'],
  operations: [
    {
      // Attach AND slash — the "one declaration, every surface" op.
      id: 'embed-file', verb: 'add',
      params: [{ name: 'path', kind: 'string' }, { name: 'pick', kind: 'boolean' }],
      appliesTo: { type: 'media' },
      surfaces: {
        slash:  { command: '/embed-file', match: { verbs: ['attach'], body: 'text-only' } },
        attach: { label: 'File', group: 'media' },
        chat:   { hint: 'embed a file' },
      },
    },
    {
      // Attach only — itemType declared explicitly, no params.
      id: 'embed-time', verb: 'add',
      appliesTo: { type: 'calendar-event' },
      surfaces: {
        attach: { label: 'Appointment', itemType: 'calendar-event' },
      },
    },
    {
      // Slash only — must NOT appear in the attach menu.
      id: 'listOpen', verb: 'list',
      surfaces: { slash: { command: '/list' }, chat: { hint: 'list' } },
    },
    {
      // No attach surface at all.
      id: 'ghost', verb: 'noop', surfaces: {},
    },
  ],
};

describe('renderAttachments — the attach projector', () => {
  const { attachMenu } = renderAttachments(manifest);

  it('filters to ops declaring surfaces.attach, ignoring the rest', () => {
    expect(attachMenu.map((e) => e.opId)).toEqual(['embed-file', 'embed-time']);
  });

  it('maps each op to an attach-menu entry { label, opId, params?, itemType?, group?, scopes }', () => {
    expect(attachMenu[0]).toEqual({
      label:    'File',
      opId:     'embed-file',
      params:   [{ name: 'path', kind: 'string' }, { name: 'pick', kind: 'boolean' }],
      itemType: 'media',
      group:    'media',
      scopes:   ['circle'],
    });
    expect(attachMenu[1]).toEqual({
      label:    'Appointment',
      opId:     'embed-time',
      itemType: 'calendar-event',
      scopes:   ['circle'],
    });
  });

  it('label defaults to the op id; itemType falls back to a single appliesTo.type', () => {
    const { attachMenu: m } = renderAttachments({
      operations: [{ id: 'bare', verb: 'add', appliesTo: { type: 'task' }, surfaces: { attach: {} } }],
    });
    expect(m[0]).toEqual({ label: 'bare', opId: 'bare', itemType: 'task', scopes: ['circle'] });
  });

  it('every entry taps to { opId, args } → callSkill, identical to a slash command', () => {
    // A menu entry carries opId; the tap builds the same waist call a slash op does.
    const entry = attachMenu[0];
    const call = { opId: entry.opId, args: { pick: true } };
    expect(call).toEqual({ opId: 'embed-file', args: { pick: true } });
  });

  it('is order-deterministic (manifest declaration order)', () => {
    expect(renderAttachments(manifest).attachMenu).toEqual(attachMenu);
  });

  it('throws when the manifest is missing', () => {
    expect(() => renderAttachments()).toThrow(/manifest required/);
  });

  it('empty attachMenu when no op declares surfaces.attach', () => {
    expect(renderAttachments({ operations: [{ id: 'x', verb: 'list', surfaces: {} }] }).attachMenu).toEqual([]);
  });
});

describe('one declaration, every surface — attach ⋂ slash', () => {
  it('an op with BOTH surfaces.attach AND surfaces.slash appears in each projector', () => {
    const { attachMenu } = renderAttachments(manifest);
    const { commandMenu } = renderChat(manifest, { skillRegistry: {}, toSkillCtx: (x) => x });

    const inAttach = attachMenu.some((e) => e.opId === 'embed-file');
    const inSlash  = commandMenu.some((c) => c.command === '/embed-file');
    expect(inAttach).toBe(true);
    expect(inSlash).toBe(true);
  });

  it('an attach-only op appears in attach but NOT in the slash command menu', () => {
    const { attachMenu } = renderAttachments(manifest);
    const { commandMenu } = renderChat(manifest, { skillRegistry: {}, toSkillCtx: (x) => x });
    expect(attachMenu.some((e) => e.opId === 'embed-time')).toBe(true);
    expect(commandMenu.some((c) => c.description === 'embed-time' || c.command?.includes('embed-time'))).toBe(false);
  });
});

describe('renderCoverage — attach is a first-class surface row', () => {
  const cov = renderCoverage(manifest);
  const byId = Object.fromEntries(cov.rows.map((r) => [r.op, r]));

  it('exposes an attach surface column', () => {
    expect(cov.surfaces.map((s) => s.key)).toContain('attach');
  });

  it('marks ops with surfaces.attach and only those', () => {
    expect(byId['embed-file'].attach).toBe(true);
    expect(byId['embed-time'].attach).toBe(true);
    expect(byId['listOpen'].attach).toBe(false);
    expect(byId['ghost'].attach).toBe(false);
    expect(cov.totals.attach).toBe(2);
  });
});

describe('two projector families are named as data', () => {
  it('renderAttachments joins the AFFORDANCE family, next to renderSlash', () => {
    expect(Object.keys(AFFORDANCE_PROJECTORS)).toEqual([
      'renderChat', 'renderSlash', 'renderGate', 'renderAttachments',
    ]);
    expect(AFFORDANCE_PROJECTORS.renderAttachments).toBe(renderAttachments);
  });

  it('the SHELL family is the whole-platform-UI projectors', () => {
    expect(Object.keys(SHELL_PROJECTORS)).toEqual(['renderWeb', 'renderMobile']);
  });

  it('renderAttachments is NOT a shell projector', () => {
    expect(SHELL_PROJECTORS.renderAttachments).toBeUndefined();
  });
});

describe('a NOUN may declare its attach entry (declare a noun → its "add" in the "+" too)', () => {
  const m = {
    app: 'household', name: 'Household',
    nouns: { note: { atoms: ['add', 'list', 'update', 'remove'],
      attach: { label: 'circle.attach.own_note', scopes: ['own'], fields: [{ name: 'body', kind: 'text', labelKey: 'circle.vandaag.plus_note_ph' }] } } },
    operations: [{ id: 'addEvent', surfaces: { attach: { label: 'x', scopes: ['own', 'circle'] } }, params: [{ name: 'title', kind: 'string', required: true }] }],
  };
  it('projects to the generic add op of the noun, with its scopes and fields', () => {
    const { attachMenu } = renderAttachments(m);
    const note = attachMenu.find((e) => e.itemType === 'note');
    expect(note.opId).toBe(encodeGenericOpId('household', 'add', 'note'));
    expect(note.scopes).toEqual(['own']);
    expect(note.fields.map((f) => f.name)).toEqual(['body']);
  });
  it('an op entry carries its scopes; an entry that names none is a circle entry', () => {
    const { attachMenu } = renderAttachments(m);
    expect(attachMenu.find((e) => e.opId === 'addEvent').scopes).toEqual(['own', 'circle']);
    const plain = renderAttachments({ app: 'x', operations: [{ id: 'a', surfaces: { attach: { label: 'y' } } }] }).attachMenu[0];
    expect(plain.scopes).toEqual(['circle']);
  });
});

describe('a noun attach declaration is validated', () => {
  it('an attach on a noun without `add`, or a scope that is no scope, is refused', async () => {
    const { validateManifest } = await import('../src/index.js');
    const base = (attach, atoms = ['add']) => ({ app: 'x', name: 'X', version: '1', itemTypes: ['note'], nouns: { note: { atoms, attach } }, operations: [] });
    const codes = (m) => (validateManifest(m).errors ?? []).map((e) => e.code);
    expect(codes(base({ label: 'k', scopes: ['own'] }))).not.toContain('bad-attach');
    expect(codes(base({ label: 'k' }, ['list']))).toContain('bad-attach');
    expect(codes(base({ scopes: ['everywhere'] }))).toContain('bad-attach');
  });
});
