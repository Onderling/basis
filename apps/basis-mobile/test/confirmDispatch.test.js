/**
 * confirmDispatch — the MOBILE confirm gate at the dispatch waist
 * (web pin: apps/basis/test/v2/confirmDialog.dom.test.js).
 *
 * Exercised at the LOGIC level through the exact module the launcher
 * imports (`src/core/confirmDispatch.js` — the shared confirmGate bound
 * to an injected `Alert.alert`), matching how the other mobile screen
 * tests assert models rather than native renders (vitest excludes
 * src/screens entirely).  The catalogue is mobile's OWN composition
 * (`composeManifests`), so the fixtures are the real merged danger ops:
 * agents revokeAgent / purgeAgent / restoreDataVersion.
 *
 * Guards the invariant the fall-through bug violated: an op declaring
 * surfaces.ui.confirm (warn/danger) NEVER executes without an explicit
 * confirmation step — `runCircleCommandResolved` used to drop
 * `needsConfirm` into the "unknown" bubble.
 */
import { describe, it, expect, vi } from 'vitest';

import { resolveDispatch } from '@onderling-app/basis';
import { composeManifests } from '../src/core/composeManifests.js';
import { runConfirmGate, confirmRequestFromRoute, alertConfirmPresenter } from '../src/core/confirmDispatch.js';
import { agentsManifest } from '../../agents/manifest.js';

const catalogue = composeManifests();
const t = (k) => k;

/** The three danger ops with COMPLETE args (so needsForm can't front the gate). */
const DANGER_FIXTURES = [
  { opId: 'revokeAgent',        args: { agentId: 'summary-bot' } },
  { opId: 'purgeAgent',         args: { agentId: 'summary-bot' } },
  { opId: 'restoreDataVersion', args: { circleId: 'c1', uri: 'mem://pod/c1/tasks.json', version: '1751880000000' } },
];

function routeFor({ opId, args }) {
  // The exact resolve call runCircleCommandResolved makes (appOrigin hint included).
  return resolveDispatch({ kind: 'slash', opId, args, appOrigin: 'agents', command: '(bot)', body: '' }, catalogue);
}

/** A fake Alert.alert that records the call and lets the test press a button. */
function fakeAlert() {
  const calls = [];
  const alert = (title, message, buttons, options) => { calls.push({ title, message, buttons, options }); };
  return { alert, calls, last: () => calls[calls.length - 1] };
}

describe('emission over the REAL mobile composition — needsConfirm before execute', () => {
  for (const fx of DANGER_FIXTURES) {
    it(`${fx.opId} with complete args resolves to needsConfirm (danger)`, () => {
      const route = routeFor(fx);
      expect(route.kind).toBe('needsConfirm');
      expect(route.severity).toBe('danger');
      const declared = agentsManifest.operations.find((o) => o.id === fx.opId).surfaces.ui.confirm;
      expect(route.message).toBe(declared.message);
    });
  }
});

describe('alertConfirmPresenter — Alert.alert as the RN presenter', () => {
  it('renders the manifest message with a destructive accept + cancel button', async () => {
    const { alert, last } = fakeAlert();
    const present = alertConfirmPresenter(alert);
    const request = confirmRequestFromRoute(routeFor(DANGER_FIXTURES[0]), { t });
    const p = present(request);
    const call = last();
    expect(call.title).toBe('circle.confirm.title');
    expect(call.message).toBe(agentsManifest.operations.find((o) => o.id === 'revokeAgent').surfaces.ui.confirm.message);
    expect(call.buttons.map((b) => b.style)).toEqual(['cancel', 'destructive']);   // danger → destructive accept
    expect(call.options).toMatchObject({ cancelable: true });
    call.buttons[1].onPress();   // accept
    await expect(p).resolves.toBe(true);
  });

  it('a warn severity accept is NOT destructive-styled', () => {
    const { alert, last } = fakeAlert();
    alertConfirmPresenter(alert)(confirmRequestFromRoute(
      { kind: 'needsConfirm', severity: 'warn', message: 'Sure?', opId: 'x', args: {} }, { t },
    ));
    expect(last().buttons[1].style).toBe('default');
  });

  it('cancel press / onDismiss resolve false; a double-firing Alert settles once', async () => {
    const { alert, last } = fakeAlert();
    const present = alertConfirmPresenter(alert);
    const p = present(confirmRequestFromRoute(routeFor(DANGER_FIXTURES[1]), { t }));
    const call = last();
    call.buttons[0].onPress();          // cancel
    call.buttons[1].onPress();          // late accept must be ignored (settled)
    call.options.onDismiss();           // and so is a late dismiss
    await expect(p).resolves.toBe(false);

    const q = present(confirmRequestFromRoute(routeFor(DANGER_FIXTURES[1]), { t }));
    last().options.onDismiss();         // Android back / outside tap ⇒ cancel
    await expect(q).resolves.toBe(false);
  });
});

describe('the full mobile chain — gate + Alert presenter + dispatch', () => {
  for (const fx of DANGER_FIXTURES) {
    it(`${fx.opId}: accept → executes exactly once with the confirmed ready dispatch`, async () => {
      const { alert, last } = fakeAlert();
      const execute = vi.fn();
      const onCancelNotice = vi.fn();
      const run = runConfirmGate({
        route: routeFor(fx), catalogue, t,
        present: alertConfirmPresenter(alert), execute, onCancelNotice,
      });
      last().buttons[1].onPress();      // the destructive accept
      const r = await run;
      expect(r.executed).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'ready', opId: fx.opId, args: fx.args, appOrigin: 'agents',
      }));
      expect(onCancelNotice).not.toHaveBeenCalled();
    });

    it(`${fx.opId}: cancel → never executes; the quiet notice fires`, async () => {
      const { alert, last } = fakeAlert();
      const execute = vi.fn();
      const onCancelNotice = vi.fn();
      const run = runConfirmGate({
        route: routeFor(fx), catalogue, t,
        present: alertConfirmPresenter(alert), execute, onCancelNotice,
      });
      last().buttons[0].onPress();      // cancel
      const r = await run;
      expect(r.executed).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(onCancelNotice).toHaveBeenCalledTimes(1);
    });
  }
});
