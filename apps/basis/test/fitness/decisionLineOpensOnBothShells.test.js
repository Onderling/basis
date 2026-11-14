/**
 * THE "A DECISION OPENED" LINE LEADS IN ON BOTH SHELLS (L887, 2026-11-14). The line's button carries one action
 * (`GOVERNANCE_OPEN_ACTION`); each shell routes it to the screen its circle menu's Decisions entry opens. The shells'
 * screen code has no unit coverage, so this reads their sources: a shell that paints the button but never routes it would
 * show a button that does nothing.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const web = read('../../web/v2/circleApp.js');
const phone = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');

describe('the decision line leads in on both shells', () => {
  it('web routes the action to showGovernance, the menu entry\'s own call', () => {
    expect(web).toMatch(/b\?\.action === GOVERNANCE_OPEN_ACTION\)\s*\{\s*showGovernance\(id\)/);
    expect(web).toMatch(/governance:\s*\(\)\s*=>\s*showGovernance\(id\)/);   // the menu entry: the same call
  });

  it('the phone routes the action to onGovernance, the menu entry\'s own handler', () => {
    expect(phone).toMatch(/button\?\.id === GOVERNANCE_OPEN_ACTION\)\s*\{\s*onGovernance\?\.\(\)/);
    expect(phone).toMatch(/governance:\s*onGovernance/);   // the menu entry: the same handler
  });
});
