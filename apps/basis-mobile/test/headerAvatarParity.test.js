/**
 * The header avatar — web ≡ mobile, from ONE source: both shells load it through the shared `loadPersonaAvatar`, paint
 * it on every tab (web: from `showTabBar`, which every top-level screen passes; mobile: in `WithTabBar`, which wraps
 * every top-level view), open the person's editor on a tap, and reload it when that editor closes. Both read the
 * picture ref through the one `pictureRefOf`. RN cannot render under Vitest, so this reads the sources.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fnOf = (src, name) => { const at = src.indexOf(`function ${name}(`); return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at)); };

describe('the header avatar — parity', () => {
  const webHost = code(read('../../basis/web/v2/circleApp.js'));
  const mobileHost = code(read('../src/screens/v2/CircleLauncherScreen.js'));
  it('both load it through the shared loader', () => {
    for (const src of [webHost, mobileHost]) expect(src).toMatch(/loadPersonaAvatar\(\{/);
  });
  it('both paint it on every tab', () => {
    expect(fnOf(webHost, 'showTabBar')).toMatch(/paintHeaderAvatar\(\)/);
    expect(fnOf(mobileHost, 'WithTabBar')).toMatch(/<HeaderAvatar\b/);
    const sites = mobileHost.match(/<WithTabBar\b[^>]*>/g) ?? [];
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) expect(s, s).toMatch(/avatar=\{headerAvatar\}/);
  });
  it('a tap opens the person\'s editor; closing it reloads the avatar', () => {
    expect(webHost).toMatch(/onOpen: \(\) => openAboutMePanel\('default'\)/);
    expect(fnOf(webHost, 'openAboutMePanel')).toMatch(/refreshHeaderAvatar\(\)/);
    expect(mobileHost).toMatch(/setMyPersona\('default'\)/);
    expect(mobileHost).toMatch(/setMyPersona\(null\); refreshHeaderAvatar\(\)/);
  });
  it('the picture ref is read once, shared', () => {
    expect(webHost).toMatch(/pictureRefOf\(/);
    expect(code(read('../src/core/mijHost.js'))).toMatch(/pictureRefOf\(/);
  });
});
