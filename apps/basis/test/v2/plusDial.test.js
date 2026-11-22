/**
 * THE "+" DOCKED IN THE TAB BAR, OPENING INTO ROUND BUTTONS — the shared model both shells paint (plusDial.js).
 *
 * Declared once in the manifest (`plus`: where it sits in the bar, which buttons it opens into, which one sits on its
 * own spot); a person's own choice of that middle spot is a device setting (`plus.middle`) that overlays the declared
 * default. What a press does is decided here, never in a shell.
 */
import { describe, it, expect } from 'vitest';
import { basisManifest } from '../../src/index.js';
import { renderMobile } from '@onderling/app-manifest';
import { validateManifest } from '@onderling/app-manifest';
import {
  plusDeclared, barSlots, plusDialFor, plusPress, PLUS_MIDDLE_KEY, PLUS_MIDDLE_CHOICES, PLUS_MIDDLE_NONE,
} from '../../src/v2/plusDial.js';
import { BASIS_USER_PARAMS } from '../../src/v2/paramsService.js';

const ids = (items) => items.map((x) => x.id);
const slotIds = (slots) => slots.map((s) => (s.kind === 'plus' ? '+' : s.tab.id));

describe('the "+" is declared once, in the manifest', () => {
  it('sits in the middle of the bar and opens into Chat · Scan · My QR, Chat on its own spot', () => {
    const plus = plusDeclared(basisManifest);
    expect(plus.place).toBe('bar-middle');
    expect(plus.middle).toBe('chat');
    expect(ids(plus.dial)).toEqual(['chat', 'scan', 'share']);
  });

  it('Scan and My QR call the existing targets (the scanQr op, the share-my-contact view), not new ones', () => {
    const plus = plusDeclared(basisManifest);
    expect(plus.dial.find((b) => b.id === 'scan').target).toEqual({ kind: 'op', opId: 'scanQr' });
    const meShare = basisManifest.meActions.find((a) => a.id === 'share-contact');
    expect(plus.dial.find((b) => b.id === 'share').target).toEqual(meShare.target);
  });

  it('both renderers project the same "+" (web ≡ mobile by construction)', () => {
    expect(plusDeclared(basisManifest, renderMobile)).toEqual(plusDeclared(basisManifest));
  });

  it('the validator refuses a place it does not know and a middle the dial does not hold', () => {
    const base = { app: 'x', itemTypes: [], operations: [], tabs: [{ id: 'a', labelKey: 'k', target: { kind: 'nav', to: 'a' } }] };
    const dial = [{ id: 'chat', labelKey: 'k', target: { kind: 'nav', to: 'plus' } }];
    expect(validateManifest({ ...base, plus: { place: 'bar-middle', middle: 'chat', dial } }).ok).toBe(true);
    expect(validateManifest({ ...base, plus: { place: 'somewhere', middle: 'chat', dial } }).ok).toBe(false);
    expect(validateManifest({ ...base, plus: { place: 'bar-middle', middle: 'scan', dial } }).ok).toBe(false);
    expect(validateManifest({ ...base, plus: { place: 'bar-middle', middle: null, dial } }).ok).toBe(true);
  });
});

describe('the bar: the tabs and the "+" in one row, from the declaration', () => {
  it('the "+" docks in the middle: two tabs on its left', () => {
    expect(slotIds(barSlots(basisManifest, { hasMesh: false }))).toEqual(['screens', 'circles', '+', 'contacten']);
    expect(slotIds(barSlots(basisManifest, { hasMesh: true }))).toEqual(['screens', 'circles', '+', 'contacten', 'nearby']);
  });

  it('moving the "+" is a data change: "bar-end" puts it last', () => {
    const m = { ...basisManifest, plus: { ...basisManifest.plus, place: 'bar-end' } };
    expect(slotIds(barSlots(m, { hasMesh: false }))).toEqual(['screens', 'circles', 'contacten', '+']);
  });

  it('a screen without the "+" (a 1:1 thread) asks for the bar without it', () => {
    expect(slotIds(barSlots(basisManifest, { hasMesh: false, plus: false }))).toEqual(['screens', 'circles', 'contacten']);
  });

  it('a manifest that declares no "+" gets a bar without one', () => {
    const { plus, ...noPlus } = basisManifest;
    expect(slotIds(barSlots(noPlus, { hasMesh: false }))).toEqual(['screens', 'circles', 'contacten']);
  });

  it('a middle of three keeps two on the left: Vandaag · Kringen · + · Contacten', () => {
    const m = basisManifest;   // the web's three tabs
    expect(slotIds(barSlots(m, { hasMesh: false }))).toEqual(['screens', 'circles', '+', 'contacten']);
  });
});

describe('which button sits on the middle spot (the person\'s choice, before the alpha)', () => {
  it('by default Chat, with Scan and My QR around it', () => {
    const d = plusDialFor(basisManifest);
    expect(d.middle.id).toBe('chat');
    expect(ids(d.around)).toEqual(['scan', 'share']);
  });

  it('a person may put another button there; Chat then sits around', () => {
    const d = plusDialFor(basisManifest, { middle: 'scan' });
    expect(d.middle.id).toBe('scan');
    expect(ids(d.around)).toEqual(['chat', 'share']);
  });

  it('or none: every button sits around and the middle is the "+" itself', () => {
    const d = plusDialFor(basisManifest, { middle: PLUS_MIDDLE_NONE });
    expect(d.middle).toBeNull();
    expect(ids(d.around)).toEqual(['chat', 'scan', 'share']);
  });

  it('an unknown value falls back to the declared default', () => {
    expect(plusDialFor(basisManifest, { middle: 'teleport' }).middle.id).toBe('chat');
  });

  it('a persona with no chat: no Chat button, and the middle spot stays empty (nothing moves up into it)', () => {
    const d = plusDialFor(basisManifest, { hasChat: false });
    expect(d.middle).toBeNull();
    expect(ids(d.around)).toEqual(['scan', 'share']);
    // …so a second tap on the "+" closes it
    expect(plusPress(true, d, 'plus')).toEqual({ open: false, run: null });
    // a person who chose another button for the middle keeps it
    expect(plusDialFor(basisManifest, { hasChat: false, middle: 'share' }).middle.id).toBe('share');
  });

  it('the ceiling 0 means no model, never no "+": the dial does not read the ceiling at all', () => {
    // the + and its chat button stay for every persona; the chat opens without a model there (the "+" door's own rule)
    expect(plusDialFor(basisManifest, { ceiling: 0 }).middle.id).toBe('chat');
  });

  it('the setting is a device param in the register, its default the manifest\'s, its choices the dial and none', () => {
    const p = BASIS_USER_PARAMS.find((x) => x.key === PLUS_MIDDLE_KEY);
    expect(p).toMatchObject({ scope: 'device', kind: 'user', default: plusDeclared(basisManifest).middle });
    expect(PLUS_MIDDLE_CHOICES.map((c) => c.value)).toEqual([...ids(plusDeclared(basisManifest).dial), PLUS_MIDDLE_NONE]);
    expect(p.choices.map((c) => c.value)).toEqual(PLUS_MIDDLE_CHOICES.map((c) => c.value));
  });
});

describe('what a press does', () => {
  const dial = plusDialFor(basisManifest);
  const noMiddle = plusDialFor(basisManifest, { middle: PLUS_MIDDLE_NONE });

  it('a tap on the closed "+" opens it and runs nothing', () => {
    expect(plusPress(false, dial, 'plus')).toEqual({ open: true, run: null });
  });

  it('a second tap on the same spot runs the middle button: a double tap lands in the chat', () => {
    expect(plusPress(true, dial, 'plus')).toEqual({ open: false, run: dial.middle });
  });

  it('with nothing in the middle, a second tap on the "+" closes it', () => {
    expect(plusPress(true, noMiddle, 'plus')).toEqual({ open: false, run: null });
  });

  it('a button around runs its target and folds everything back', () => {
    expect(plusPress(true, dial, 'scan')).toEqual({ open: false, run: dial.around[0] });
  });

  it('a touch outside, the back gesture or Escape folds it back and runs nothing', () => {
    expect(plusPress(true, dial, 'outside')).toEqual({ open: false, run: null });
  });

  it('nothing but the "+" opens it', () => {
    expect(plusPress(false, dial, 'scan')).toEqual({ open: false, run: null });
    expect(plusPress(false, dial, 'outside')).toEqual({ open: false, run: null });
  });
});
