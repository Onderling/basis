/**
 * A CIRCLE'S LISTS ARE A TAB BESIDE TASKS (walk rows 62/64; Frits: "a tab in the circle, the settings switch = that
 * tab"). The tab is the lists feature's surface: on, the circle shows a Lists tab after Tasks; off, no tab. The tab
 * paints the circle's lists screen itself (make a list, add an entry, tick one off), the one both shells already had
 * behind the circle's menu, so nothing is drawn twice: web renders the panel's body into the tab, the phone mounts
 * the same screen inside it. The lists block is no longer the gate for the "+".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCircleTabs } from '../../src/v2/circleTabs.js';
import * as circleTabs from '../../src/v2/circleTabs.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe("a circle's Lists tab", () => {
  it('is on with the lists feature, after Tasks; off, there is no tab', () => {
    expect(buildCircleTabs({ features: { noticeboard: false, tasks: true, lists: true, memberDirectory: false } }).map((t) => t.id)).toEqual(['conversation', 'tasks', 'lists']);
    expect(buildCircleTabs({ features: { noticeboard: false, tasks: true, lists: false, memberDirectory: false } }).map((t) => t.id)).toEqual(['conversation', 'tasks']);
  });

  it('the block is no longer the surface the "+" waits for', () => {
    expect(circleTabs.BLOCK_SURFACED).toBeUndefined();
    expect(read('../../src/v2/attachEntries.js')).not.toMatch(/blockTypes/);
  });

  it('web paints the same lists body in the tab as in the panel', () => {
    const app = read('../../web/v2/circleApp.js');
    expect(app).toMatch(/function renderListsInto\(body, circleId\) \{/);
    expect(app).toMatch(/function openListsPanel\(circleId\) \{[\s\S]*?renderListsInto\(body, circleId\);\n\}/);
    expect(app).toMatch(/listsTab: \{ render: \(el\) => renderListsInto\(el, id\) \}/);
    expect(read('../../web/v2/circleView.js')).toMatch(/\} else if \(effectiveTab === 'lists'\) \{\s+listsTab\?\.render\?\.\(body\);/);
  });

  it('the phone mounts its lists screen in the tab', () => {
    const src = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
    expect(src).toMatch(/\) : activeTab === 'lists' \? \(\s+(\/\/[^\n]*\n\s+)?<View testID="circle-detail-lists"[^>]*>\s+<CircleListsScreen embedded/);
    // the screen's own back row is for a list it opened, not for the tab
    expect(read('../../../basis-mobile/src/screens/v2/CircleListsScreen.js')).toMatch(/\{\(!embedded \|\| openList\) \? \(/);
  });
});
