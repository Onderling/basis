/**
 * A failed agent boot is SAID on the launcher — the surface a person is looking at — on both shells.
 *
 * Both shells used to degrade a dead boot into "No circles yet." (web: a console.warn; mobile: the error
 * went to the hidden ChatScreen). A person reads that as "my data is gone". This reads the source because
 * the shells have no runtime coverage: each launcher must paint `circle.boot_failed`, and each app must
 * hand it the failure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');

describe('a failed boot is said where the person looks', () => {
  it('web: the launcher paints it, and the app hands it over', () => {
    expect(read('../../web/v2/circleLauncher.js')).toMatch(/tr\('circle\.boot_failed'/);
    const app = read('../../web/v2/circleApp.js');
    expect(app).toMatch(/_bootFailure = err/);
    expect(app).toMatch(/bootFailure: _bootFailure/);
  });
  it('mobile: the launcher paints it, and App.js hands it to the LAUNCHER (not only the hidden chat)', () => {
    expect(read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js')).toMatch(/t\('circle\.boot_failed'/);
    const app = read('../../../basis-mobile/App.js');
    const launcher = app.slice(app.indexOf('<CircleLauncherScreen'), app.indexOf('/>', app.indexOf('<CircleLauncherScreen')));
    expect(launcher).toMatch(/bootError=\{bootError\}/);
  });
});
