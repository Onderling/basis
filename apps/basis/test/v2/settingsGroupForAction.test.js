/**
 * Mij's device and agent rows and the device offer open Apparaten & sleutels — one answer both shells read; the old
 * My data page is no longer where devices live.
 */
import { describe, it, expect } from 'vitest';
import { settingsGroupForAction, settingsGroupFor } from '../../src/v2/settingsHome.js';
import { basisManifest } from '../../manifest.js';

describe('settingsGroupForAction', () => {
  it('open-my-data (agents block) and open-mydata (the offer chip) open the declared devices group', () => {
    for (const kind of ['open-my-data', 'open-mydata']) {
      const id = settingsGroupForAction({ kind });
      expect(id).toBe('devices-keys');
      expect(settingsGroupFor(basisManifest, id)?.sections.map((s) => s.id)).toContain('devices');
    }
    expect(settingsGroupForAction({ kind: 'open-shared-with-me' })).toBeNull();
    expect(settingsGroupForAction(null)).toBeNull();
  });
});
