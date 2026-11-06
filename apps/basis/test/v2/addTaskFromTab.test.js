/**
 * "＋ ADD TASK" ON THE TASKS TAB OPENS THE TASK FORM. A walk (2026-11-05) found it doing nothing on both phones: mobile
 * put "/addtask " into a composer the Tasks tab does not show; web asked through `prompt()`. The tab's button now runs
 * the SAME "+" entry the composer offers ("+ → Task"), found by its declared item type, and is not painted where this
 * circle offers no such entry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attachEntriesFor, attachEntryForType } from '../../src/v2/attachEntries.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('the Tasks tab add button', () => {
  it('finds the composer\'s task entry by its declared type', () => {
    const entries = attachEntriesFor({ manifestsByOrigin: { tasks: tasksManifest } });
    expect(attachEntryForType(entries, 'task')).toMatchObject({ opId: 'addTask', appOrigin: 'tasks', itemType: 'task' });
  });

  it('is absent where the circle offers no task entry (never offer what does not work)', () => {
    expect(attachEntryForType([], 'task')).toBeNull();
  });

  it('both shells run that entry from the tab — no prompt(), no composer text the tab cannot show', () => {
    const web = read('../../web/v2/circleApp.js');
    const mobile = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
    expect(/attachCommandDispatch\(\s*entry\s*\)/.test(web.slice(web.indexOf('async function addTaskFromTab')))).toBe(true);
    expect(web.includes("circle.view.tasks_add_prompt")).toBe(false);
    expect(/runAttachEntry\(\s*attachEntryForType\(\s*attachEntries\s*,\s*'task'\s*\)\s*\)/.test(mobile)).toBe(true);
    expect(mobile.includes("setComposerText('/addtask ')")).toBe(false);
  });
});
