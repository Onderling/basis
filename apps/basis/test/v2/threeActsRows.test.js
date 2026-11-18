/**
 * Three person acts have their own capability rows, on by default (ledger L1052).
 *
 * @guard confirming a claim, editing and sharing an appointment pass the capability gate in a circle that did not switch them off
 *
 * Found 2026-11-18 (L1042's guard): `tasks.confirmClaim` (task × confirm), `calendar.updateEvent` (calendar-event ×
 * update) and `calendar.shareEvent` (calendar-event × share) named a noun whose atom had no row, so the gate refused
 * them in every circle; a tap worked only because it walked around the gate.
 */
import { describe, it, expect } from 'vitest';
import { effectiveCapabilities, checkCapability, capabilityKey } from '../../src/v2/capabilityGate.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';
import { calendarManifest } from '../../../calendar/manifest.js';

const sources = [{ manifest: tasksManifest, appOrigin: 'tasks' }, { manifest: calendarManifest, appOrigin: 'calendar' }];
const ACTS = [['tasks', tasksManifest, 'confirmClaim', 'confirm task'], ['calendar', calendarManifest, 'updateEvent', 'update calendar-event'], ['calendar', calendarManifest, 'shareEvent', 'share calendar-event']];
const gate = (eff, [app, m, id]) => checkCapability({ op: m.operations.find((o) => o.id === id), appOrigin: app, args: {} }, eff);

describe('three person acts have rows, on by default', () => {
  it('each passes the gate by default, through its own row', () => {
    const eff = effectiveCapabilities(sources, { apps: null });
    for (const act of ACTS) expect(gate(eff, act), act[2]).toEqual({ allow: true, capability: `${act[0]} ${act[3]}` });
  });

  it('a circle whose stored template PREDATES the new rows has them ON (an existing circle loses nothing)', () => {
    // a template an admin saved before these rows existed: it names other rows, not these
    const old = { [capabilityKey('calendar', 'add', 'calendar-event')]: { enabled: false }, [capabilityKey('tasks', 'claim', 'task')]: { enabled: true } };
    const eff = effectiveCapabilities(sources, { apps: null, capabilities: old });
    for (const act of ACTS) expect(gate(eff, act).allow, act[2]).toBe(true);
  });

  it('switched off, each is refused (the row is a real switch)', () => {
    for (const act of ACTS) {
      const eff = effectiveCapabilities(sources, { apps: null, capabilities: { [`${act[0]} ${act[3]}`]: { enabled: false } } });
      expect(gate(eff, act).allow, act[2]).toBe(false);
    }
  });
});
