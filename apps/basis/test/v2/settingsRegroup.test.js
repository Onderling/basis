/**
 * The settings regrouped (Frits 2026-11-20, the regroup "stands as proposed"): what the home lists, in which order, and
 * which sections each group holds — all of it the manifest's `settingsGroups`, so a later move is a data change. The
 * persona panel's device rows and the device offer open Apparaten; the copy-log door sits beside Feedback geven.
 */
import { describe, it, expect } from 'vitest';
import { basisManifest } from '../../manifest.js';
import { settingsHomeFor, settingsGroupFor, settingsGroupForAction } from '../../src/v2/settingsHome.js';

const sectionsOf = (id) => settingsGroupFor(basisManifest, id)?.sections.map((s) => s.id) ?? null;

describe('the settings regroup', () => {
  it('the home: Weergave · Meldingen · Assistent · Verbinding · Apparaten · Herstel · Mijn gegevens, then the doors', () => {
    const { groups, perCircle, doors } = settingsHomeFor(basisManifest);
    expect(groups.map((g) => g.id)).toEqual(['appearance', 'notifications', 'assistant', 'connection', 'devices', 'recovery', 'my-data']);
    expect(perCircle?.id).toBe('per-circle');
    // Feedback geven with "Meld een probleem" (the copy-log screen) right beside it
    expect(doors.map((d) => d.id)).toEqual(['help', 'intro', 'feedback', 'log-report']);
    expect(doors.find((d) => d.id === 'log-report').target).toEqual({ kind: 'nav', to: 'logReport' });
  });

  it('each group holds what the regroup gave it, in order', () => {
    expect(sectionsOf('appearance')).toEqual(['theme', 'language', 'start-screen', 'plus-middle']);
    expect(sectionsOf('notifications')).toEqual(['notifications', 'week-overview']);
    expect(sectionsOf('assistant')).toEqual(['assistant', 'bot-actions']);
    // availability left: it is on Vandaag (its screen opens from that block)
    expect(sectionsOf('connection')).toEqual(['connection-points', 'relay', 'address-sharing', 'delivery']);
    expect(sectionsOf('devices')).toEqual(['devices', 'device-add', 'device-replace', 'device-primary', 'connections', 'connection-add', 'agents', 'companion-claim', 'bot-link']);
    expect(sectionsOf('recovery')).toEqual(['recovery-phrase', 'restore', 'recovery-file', 'personas-receive', 'app-lock']);
    expect(sectionsOf('my-data')).toEqual(['history-mirror', 'message-cleanup', 'privacy', 'usage', 'frequent', 'own-actions', 'device-keeps', 'storage']);
  });

  it('no section is declared twice, and the old groups are gone', () => {
    const all = settingsHomeFor(basisManifest).groups.flatMap((g) => g.sections.map((s) => s.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('availability');
    expect(all).not.toContain('keys');
    expect(all).not.toContain('log-report');
    expect(settingsGroupFor(basisManifest, 'devices-keys')).toBeNull();
  });

  it('the persona panel\'s device rows and the device offer open Apparaten', () => {
    expect(settingsGroupForAction({ kind: 'open-my-data' })).toBe('devices');
    expect(settingsGroupForAction({ kind: 'open-mydata' })).toBe('devices');
  });
});
