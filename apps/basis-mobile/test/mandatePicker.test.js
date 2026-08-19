/**
 * The MOBILE entrust (toevertrouwen) picker — logic parity with the web picker
 * (web pin: apps/basis/test/v2/mandatePicker.dom.test.js).
 *
 * Vitest excludes src/screens entirely (RN can't render here), so — like the
 * other mobile screen tests — this asserts the PURE model the RN component
 * (CircleMandatePicker) projects, imported from the SAME shared module the web
 * picker consumes (apps/basis/src/v2/mandate.js). That is the web≡mobile
 * guarantee: one source, so the two pickers can't drift on kinds/copy/behaviour.
 *
 * The confirm ROUTING (attachTaskGrant → the shared confirm gate) is asserted
 * over mobile's OWN manifest composition, mirroring confirmDispatch.test.js.
 */
import { describe, it, expect } from 'vitest';

import { resolveDispatch } from '@onderling-app/basis';
import { composeManifests } from '../src/core/composeManifests.js';
import {
  buildMandateGrant,
  grantKindOptions,
  mandateRoster,
  mandateConfirmEnabled,
  mandateConfirmPayload,
  mandateLegibilityRows,
} from '../../basis/src/v2/mandate.js';

const t = (key, params = {}) => {
  if (key === 'circle.mandate.existing_row') return `${params.who} — ${params.what}`;
  if (key === 'circle.mandate.on_your_behalf') return 'On your behalf';
  return key;
};

const members = [
  { webid: 'https://me.example/#me', name: 'Me' },
  { webid: 'https://alice.example/#me', name: 'Alice' },
  { webid: 'https://bob.example/#me', name: 'Bob' },
];
const offerings = [
  { key: 'off-baking', text: 'Baking' },
  { key: 'off-rides', text: 'Rides' },
];
const optById = (id) => grantKindOptions({ offerings, t }).flatMap((g) => g.rows).find((o) => o.id === id);

describe('buildMandateGrant (shared with web)', () => {
  it('builds the "namens jou" grant — actingAs + brokered, no skill', () => {
    expect(buildMandateGrant({ myWebid: 'https://me.example/#me' })).toEqual({
      actingAs: 'https://me.example/#me', constraints: { broker: true },
    });
  });

  it('narrows to one offering (attenuation → grant.skill)', () => {
    expect(buildMandateGrant({ kind: 'offering', myWebid: 'https://me.example/#me', offeringKey: 'off-baking' })).toEqual({
      actingAs: 'https://me.example/#me', skill: 'off-baking', constraints: { broker: true },
    });
  });

  it('kind:resource mints a per-grain res.read:<id> capability (item grain; device+requestable defaults)', () => {
    expect(buildMandateGrant({ kind: 'resource', scope: 'mem://pod/me/agenda.json' })).toEqual({
      skill: 'res.read:mem://pod/me/agenda.json',
      constraints: { broker: true, via: 'device', use: 'requestable', grain: 'item' },
    });
  });
});

describe('WAARVOOR taxonomy — the three grant kinds the mobile picker renders', () => {
  it('renders actAs, one row per HELD offering, and resource', () => {
    const rows = grantKindOptions({ offerings, t }).flatMap((g) => g.rows);
    expect(rows.find((o) => o.id === 'actAs')).toBeTruthy();
    expect(rows.filter((o) => o.kind === 'offering')).toHaveLength(2);   // only offerings I hold
    expect(rows.find((o) => o.kind === 'resource')).toBeTruthy();
  });

  it('resource is first-class but NOT issuable (nog niet actief) — carries the honest note', () => {
    const resource = optById('resource');
    expect(resource.active).toBe(false);
    expect(resource.note).toBe('circle.mandate.kind.resource_note');
    // A selected inactive kind blocks confirm and builds no payload.
    expect(mandateConfirmEnabled({ pickedMember: 'https://alice.example/#me', pickedWhat: resource })).toBe(false);
    expect(mandateConfirmPayload({ taskId: 't1', myWebid: 'm', pickedMember: 'https://alice.example/#me', pickedWhat: resource })).toBeNull();
  });
});

describe('roster selection', () => {
  it('lists the roster minus myself', () => {
    expect(mandateRoster({ members, myWebid: 'https://me.example/#me' }).map((m) => m.webid))
      .toEqual(['https://alice.example/#me', 'https://bob.example/#me']);
  });

  it('confirm is disabled until a member is picked', () => {
    expect(mandateConfirmEnabled({ pickedMember: null, pickedWhat: optById('actAs') })).toBe(false);
    expect(mandateConfirmEnabled({ pickedMember: 'https://alice.example/#me', pickedWhat: optById('actAs') })).toBe(true);
  });
});

describe('confirm payload (what onConfirm dispatches)', () => {
  it('the "namens jou" default → actingAs + brokered', () => {
    expect(mandateConfirmPayload({
      taskId: 'task-1', myWebid: 'https://me.example/#me',
      pickedMember: 'https://alice.example/#me', pickedWhat: optById('actAs'),
    })).toEqual({
      taskId: 'task-1', member: 'https://alice.example/#me',
      grant: { actingAs: 'https://me.example/#me', constraints: { broker: true } },
    });
  });

  it('a picked offering narrows to grant.skill', () => {
    expect(mandateConfirmPayload({
      taskId: 'task-9', myWebid: 'https://me.example/#me',
      pickedMember: 'https://bob.example/#me', pickedWhat: optById('offering:off-rides'),
    }).grant).toEqual({ actingAs: 'https://me.example/#me', skill: 'off-rides', constraints: { broker: true } });
  });
});

describe('legibility rows (existing mandates)', () => {
  it('resolves who + what from source.taskGrants; skips malformed rows', () => {
    const rows = mandateLegibilityRows(
      [{ member: 'https://alice.example/#me', skill: 'off-baking' }, { member: 'https://bob.example/#me' }, null, { skill: 'x' }],
      { members, offerings, t },
    );
    expect(rows.map((r) => `${r.who} — ${r.what}`)).toEqual(['Alice — Baking', 'Bob — On your behalf']);
  });
});

describe('confirm ROUTING — attachTaskGrant hits the shared confirm gate over the mobile composition', () => {
  const catalogue = composeManifests();
  it('resolves to needsConfirm (never a silent execute)', () => {
    const route = resolveDispatch(
      { kind: 'slash', opId: 'attachTaskGrant', args: { taskId: 'task-1', member: 'https://alice.example/#me' }, appOrigin: 'tasks', command: '(bot)', body: '' },
      catalogue,
    );
    expect(route.kind).toBe('needsConfirm');
  });
});
