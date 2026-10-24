/**
 * A screen an op opens (`surfaces.ui.screen`) is a view of the SAME app: the panel resolves it through
 * `sectionForScreen` over that app's manifest alone. One owner per concept — when another app's view answered
 * for it, deleting that view left the tasks screen's panel empty on both shells.
 */
import { describe, it, expect } from 'vitest';
import { sectionForScreen } from '../../src/v2/pageProjection.js';
import { basisManifest } from '../../manifest.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';
import { householdManifest } from '../../../household/manifest.js';
import { pinboardManifest } from '../../../pinboard/manifest.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { agentsManifest } from '../../../agents/manifest.js';
import { folioManifest } from '../../../folio/manifest.js';
import { listsManifest } from '../../../lists/manifest.js';

const manifests = [basisManifest, tasksManifest, householdManifest, pinboardManifest, calendarManifest, agentsManifest, folioManifest, listsManifest];

describe('every op-opened screen is a view of its own app', () => {
  const screens = manifests.flatMap((m) => (m.operations ?? [])
    .filter((op) => typeof op?.surfaces?.ui?.screen === 'string')
    .map((op) => ({ app: m.app ?? m.appId, op: op.id, screen: op.surfaces.ui.screen, manifest: m })));

  it('there are such screens (the probe is not empty)', () => {
    expect(screens.map((s) => `${s.app}.${s.op}`)).toContain('tasks.listMine');
  });

  it("the tasks screen reads THIS circle's store (the tasks resolver is per circle)", () => {
    const { section } = sectionForScreen({ tasks: tasksManifest }, 'tasks');
    expect(section.dataSource).toMatchObject({ skillId: 'listOpen', argsFromContext: { circleId: '$circleId' } });
  });

  for (const s of screens) {
    it(`${s.app}.${s.op} → screen '${s.screen}' resolves in ${s.app}'s own manifest`, () => {
      const found = sectionForScreen({ [s.app]: s.manifest }, s.screen);
      expect(found, `no view '${s.screen}' in ${s.app}`).not.toBeNull();
      expect(found.section.dataSource?.skillId, 'the view names its list op').toBeTruthy();
    });
  }
});
