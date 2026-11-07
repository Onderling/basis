/**
 * THE NEARBY ASK BOX'S SECOND BUTTON SAYS "CANCEL".
 *
 * A walk saw "Ask" and "← circles" side by side on Nearby's ask box: the second one closes the box, so it is a cancel,
 * and it said where it would go instead. One label the app already has (circle.confirm.cancel).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const LAUNCHER = fs.readFileSync(path.join(process.cwd(), '../basis-mobile/src/screens/v2/CircleLauncherScreen.js'), 'utf8');

describe('Nearby\'s ask box', () => {
  it('names its closing button Cancel', () => {
    const at = LAUNCHER.indexOf('testID="nearby-ask-cancel"');
    expect(at, 'the ask box has a cancel').toBeGreaterThan(-1);
    const button = LAUNCHER.slice(at, LAUNCHER.indexOf('</Pressable>', at));
    expect(button).toContain("t('circle.confirm.cancel')");
  });
});
