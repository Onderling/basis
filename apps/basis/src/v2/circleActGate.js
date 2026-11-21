/**
 * circleActGate — a person's act that WRITES in a circle asks that circle's capability set, at the OUTER waist (ledger
 * L1042; docs/architecture.md §3 "Can this op happen here?": the `availability` layer, asked where a tap cannot walk
 * around it).
 *
 * Before this, only the chat and bubble routes asked the circle (web `circleCapabilityDeny`, the phone's twin); a tap on
 * a screen (the noticeboard's chips, the lists panel) went to `callSkill` directly, so a capability a circle switched
 * off could still be used by tapping. The check now runs once, in shared code, beside the own-act record, and reads
 * the same things that record reads:
 *   - a PERSON's act: the call names a person door (`isPersonDoor`, the own record's reading); a door-less call (a
 *     screen's own writes, plumbing) is not checked;
 *   - that WRITES: a read is not checked here (reads are their own row: blanking a screen needs a look);
 *   - in a CIRCLE: the op's writes are the circle's (`writes.scope`), not a person's own or a device's; the circle is
 *     the op's own argument (`circleArg`), else the circle the person is looking at; the person's own place
 *     (`isOwnPlaceId`) is no circle;
 *   - that the circle CAN switch off: an op with no row a circle could turn is not refused here (logged as `no-row`).
 * The circle's policy and the member's opt-outs come from the shell's own stores through ONE reader handed in at
 * composition (`circleCapabilityInputs`); nothing is decided in a shell. No reader (the box, until its row): no check.
 */
import { verbKind, circleArg } from '@onderling/app-manifest';
import { isPersonDoor } from '../ownActions.js';
import { effectiveCapabilities, checkCapability } from './capabilityGate.js';
import { refuse } from './refusal.js';
import { isAppSurfaceEnabled } from './appFeature.js';
import { isFeatureEnabled } from './circlePolicy.js';
import { processRefusalLog } from './refusalLog.js';
import { isOwnPlaceId } from './grantsManifest.js';

/** Scopes whose writes are not a circle's (a person's own, this device's): no circle's switch governs them. */
const NOT_A_CIRCLES = new Set(['person', 'device', 'own']);

/**
 * Should this call be refused by its circle's capability set? `null` = go on; else the refusal `{layer, code}`.
 * @param {object} a
 * @param {string} a.app @param {string} a.op @param {object} [a.args] @param {object} [a.ctx]
 * @param {object[]} a.manifests   every manifest the waist knows (the gate's sources)
 * @param {() => string|null} [a.activeCircle]   the circle the person is looking at
 * @param {(circleId: string) => Promise<{policy?: object, override?: object}|null>} [a.inputs]   the shell's reader
 * @returns {Promise<{layer: string, code: string}|null>}
 */
export async function circleActRefusal({ app, op, args = {}, ctx = {}, manifests = [], activeCircle = () => null, inputs = null }) {
  if (typeof inputs !== 'function') return null;
  if (!isPersonDoor(ctx?.door)) return null;
  const m = (Array.isArray(manifests) ? manifests : []).find((x) => x?.app === app);
  const declared = m?.operations?.find((o) => o?.id === op);
  if (!declared) return null;
  if (verbKind(m, declared.verb) === 'read') return null;
  if (NOT_A_CIRCLES.has(declared?.writes?.scope)) return null;
  const circleId = circleArg(args) ?? activeCircle?.() ?? null;
  if (!circleId) return null;
  // the person's OWN place is no circle: none of a circle's switches governs it (an own appointment from the '+')
  if (isOwnPlaceId(circleId)) return null;
  let given = null;
  try { given = await inputs(circleId); } catch {
    // a broken store must not be an open gate nobody sees: the act goes on, and the log says so (codes only)
    processRefusalLog().note({ tag: 'gate', lane: 'availability', check: 'circle-inputs', reason: 'reader-threw' });
    given = null;
  }
  if (!given) return null;
  const v = circleCapabilityVerdict({ app, op: declared, args, manifests, policy: given.policy ?? {}, optOuts: given.override?.capabilityOptOuts });
  return v.allow ? null : refuse('availability', v.code);
}

/**
 * THE ONE DECISION a circle's switches make about an act, pure: the sender's gate above asks it for a person's op, and
 * the receiving rails ask it for a statement that arrived (a circle's switches bind on every member's device), with
 * the settings the content line picked (contentLine.js) and WITHOUT a member's opt-outs, which bind only that member's
 * own device. Either an `op` (its verb and nouns read from the manifest) or an explicit `atom` + `noun`.
 * @param {object} a
 * @param {string} a.app
 * @param {object} [a.op]  the manifest op declaration
 * @param {string} [a.atom] @param {string} [a.noun]
 * @param {object} [a.args]
 * @param {object[]} a.manifests
 * @param {object} a.policy  the circle's settings to judge by
 * @param {object} [a.optOuts]  the member's own opt-outs (the sender's gate only)
 * @returns {{allow: true, reason?: 'no-row'}|{allow: false, code: 'app-disabled'|'capability-denied'}}
 */
export function circleCapabilityVerdict({ app, op = null, atom = null, noun = null, args = {}, manifests = [], policy = {}, optOuts = null }) {
  const sources = (Array.isArray(manifests) ? manifests : []).map((x) => ({ manifest: x, appOrigin: x?.app }));
  // the app is on in this circle, read as the typed path reads it (`isAppSurfaceEnabled` over the circle's policy)
  const appOn = isAppSurfaceEnabled(app, policy ?? {}, isFeatureEnabled);
  const eff = effectiveCapabilities(sources, { apps: appOn ? [app] : [], capabilities: policy?.capabilities, optOuts });
  const ask = { op, appOrigin: app, args, ...(op ? {} : { atom, noun }) };
  const r = checkCapability(ask, eff);
  if (r.allow) return { allow: true };
  // A circle refuses only what it CAN switch off. Refused even with the app on and nothing switched off, the act has no
  // row a circle could turn (posting an offer, setting a role: the rows the capability set still lacks); that is not
  // this circle's decision, so the act goes on and the log says so in codes, for the row to be added.
  if (r.code === 'capability-denied' && !checkCapability(ask, effectiveCapabilities(sources, { apps: [app] })).allow) {
    processRefusalLog().note({ tag: 'gate', lane: 'availability', check: 'circle-capability', reason: 'no-row' });
    return { allow: true, reason: 'no-row' };
  }
  return { allow: false, code: r.code };
}

/**
 * The words a refusal from this layer is told in, the SAME for a typed line and a tap: a key under `circle.gate`.
 * @param {string} code   `app-disabled` or `capability-denied`
 */
export function gateRefusalKey(code) {
  return code === 'app-disabled' ? 'circle.gate.appDisabled' : 'circle.gate.capabilityDenied';
}

/**
 * Which app declares an item type, and the noun it is: from the manifests' `itemTypes` (one source, no second table).
 * `null`: no manifest declares it (a lane-carried row, an extension this node does not run).
 * @param {object[]} manifests @param {string} type
 * @returns {{app: string, noun: string}|null}
 */
export function itemTypeCapability(manifests, type) {
  if (typeof type !== 'string' || !type) return null;
  const m = (Array.isArray(manifests) ? manifests : []).find((x) => Array.isArray(x?.itemTypes) && x.itemTypes.includes(type));
  return m ? { app: m.app, noun: type } : null;
}

/** The atoms that are not a change: making a row, reading, removing. Every other declared atom changes a held row. */
const NOT_A_CHANGE = new Set(['add', 'list', 'remove']);

/**
 * An item statement that arrived, judged by the circle's switches (the rails' side of `circleCapabilityVerdict`): a row
 * this device does not hold is an `add`, a row it holds a `change` (taken when ANY change atom of the type is on: which
 * change it was is not told apart until each type declares its fields per atom), a remove a `remove`.
 * @param {object} a
 * @param {object[]} a.manifests @param {object} a.policy  the settings the content line picked
 * @param {string} a.type @param {'add'|'change'|'remove'} a.act
 * @returns {{allow: true, reason?: string}|{allow: false, code: string}}
 */
export function itemStatementVerdict({ manifests = [], policy = {}, type, act }) {
  const cap = itemTypeCapability(manifests, type);
  if (!cap) return { allow: true, reason: 'no-type' };
  if (act !== 'change') return circleCapabilityVerdict({ app: cap.app, atom: act, noun: cap.noun, manifests, policy });
  const m = manifests.find((x) => x?.app === cap.app);
  const atoms = (m?.nouns?.[cap.noun]?.atoms ?? []).filter((a) => !NOT_A_CHANGE.has(a));
  // no change atom declared: the type has no row a circle could turn for a change (the verdict's own no-row rule)
  if (!atoms.length) return circleCapabilityVerdict({ app: cap.app, atom: 'update', noun: cap.noun, manifests, policy });
  let refused = null;
  for (const atom of atoms) {
    const v = circleCapabilityVerdict({ app: cap.app, atom, noun: cap.noun, manifests, policy });
    if (v.allow) return { allow: true };
    refused = refused ?? v;
  }
  return refused;
}

/**
 * A WRITE INTO ANOTHER CIRCLE asks that circle too. An op's door asks the switches of the circle the op names; a few ops
 * also write a row into a DIFFERENT circle (an appointment's copy into a paired circle, a share into a target circle, a
 * sealed copy back into the source). That circle's switches were never asked on the sender, so the row showed there and
 * was refused on every other member's device. Before such a write, this asks the target circle the question its
 * receivers will ask (`itemStatementVerdict`), with its settings read as the sender's gate reads them (`inputs`):
 * null when the write may go, else the door's own refusal (its code, told in the door's words: `gateRefusalKey`).
 * @param {object} a
 * @param {string} a.circleId  the circle the row is written INTO
 * @param {string} a.type      the row's item type
 * @param {'add'|'change'|'remove'} [a.act]
 * @param {object[]} a.manifests
 * @param {(circleId: string) => Promise<{policy?: object}|null>} a.inputs  the sender's gate's own reader
 */
export async function writeIntoRefusal({ circleId, type, act = 'add', manifests = [], inputs = null } = {}) {
  if (typeof inputs !== 'function' || typeof circleId !== 'string' || !circleId || isOwnPlaceId(circleId)) return null;
  let given = null;
  try { given = await inputs(circleId); } catch {
    processRefusalLog().note({ tag: 'gate', lane: 'availability', check: 'circle-inputs', reason: 'reader-threw' });
    given = null;
  }
  if (!given) return null;
  const v = itemStatementVerdict({ manifests, policy: given.policy ?? {}, type, act });
  return v.allow ? null : refuse('availability', v.code);
}
