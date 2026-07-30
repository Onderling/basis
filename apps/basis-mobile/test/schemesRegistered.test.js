/**
 * FITNESS — every URI scheme this product BUILDS must be one the OS will hand back to it.
 *
 * `QR_URI_PREFIXES` is the canonical registry of schemes basis produces and recognises. Recognition is
 * enough for a scanned or pasted URI: the payload is already inside the app by then. A link someone taps
 * in a chat is a different question — the operating system has to know the app claims that scheme, or
 * tapping it does nothing at all.
 *
 * The two drifted, and the drift was invisible for exactly that reason (found walking S4, 2026-07-30):
 * `basis://` was registered, `onderling-invite://` — the scheme every circle invite actually uses — was not.
 * Sharing an invite the most natural way, by sending someone the link, produced a dead string, while
 * scanning and pasting both worked fine.
 *
 * So the registry is the source of truth and the app config must agree with it. If a scheme is added to
 * one and not the other, this fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QR_URI_PREFIXES, OS_REGISTERED_SCHEMES } from '../../basis/src/core/qrSchemes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appJson = JSON.parse(readFileSync(path.join(here, '..', 'app.json'), 'utf-8'));

describe('FITNESS: the app claims every scheme it hands out', () => {
  const declared = [].concat(appJson.expo.scheme ?? []);

  it('app.json declares a scheme for every entry in the QR registry', () => {
    const missing = OS_REGISTERED_SCHEMES.filter((s) => !declared.includes(s));
    expect(
      missing,
      'these schemes are produced by the app but no OS will route them back to it — a link someone taps '
      + 'in a chat does nothing. Add them to `expo.scheme` in app.json.',
    ).toEqual([]);
  });

  it('the derived list matches the registry it comes from', () => {
    expect(OS_REGISTERED_SCHEMES.length).toBe(QR_URI_PREFIXES.length);
    for (const s of OS_REGISTERED_SCHEMES) expect(s).not.toContain(':');
  });

  it('`onderling-invite` in particular — the one that was missing', () => {
    // Named explicitly because it is the scheme of the first thing a new person ever receives.
    expect(declared).toContain('onderling-invite');
  });

  // This guard originally stopped at app.json, which turned out to be one layer ABOVE where the failure
  // was (2026-07-30). `expo.scheme` is only a build INPUT: it reaches Android through `expo prebuild`,
  // which regenerates AndroidManifest.xml. Nobody had re-run it, so app.json listed four schemes, the
  // manifest listed one, `dumpsys package` agreed with the manifest, and the OS refused every
  // onderling-invite:// link — with the guard passing the whole time.
  it('the ANDROID MANIFEST declares them too — app.json alone proves nothing on device', () => {
    const manifest = readFileSync(
      path.join(here, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf-8',
    );
    const missing = OS_REGISTERED_SCHEMES.filter((sc) => !manifest.includes(`android:scheme="${sc}"`));
    expect(
      missing,
      'declared in app.json but absent from the native manifest — `expo prebuild` has not been re-run, so '
      + 'the OS does not know the app claims these. Links are dead on device even though this config looks '
      + 'right in JS.',
    ).toEqual([]);
  });
});

describe('FITNESS: something actually RECEIVES an incoming link', () => {
  // The other half, and the one that cost the most: every layer of this — app.json, the registry, the
  // native manifest, `decodeInvite` — can be correct while the app still drops invites, because nothing
  // subscribes to the URL. `basis-mobile` had no `Linking` reference anywhere at all. A registered scheme
  // with no listener is *worse* than an unregistered one: the OS opens the app, so it looks like the link
  // worked.
  it('the mobile shell subscribes to incoming URLs, cold start AND warm', () => {
    const chat = readFileSync(path.join(here, '..', 'src', 'screens', 'ChatScreen.js'), 'utf-8');
    expect(chat, 'no Linking import — incoming links cannot arrive').toMatch(/\bLinking\b/);
    // A cold start arrives only via getInitialURL; a warm one only via the event. Having just the second
    // is the usual shape of this bug — the link works if the app is already open and not otherwise.
    expect(chat, 'no cold-start path: a link that launches the app is dropped').toContain('getInitialURL');
    expect(chat, 'no warm path: a link tapped while the app runs is dropped').toMatch(
      /addEventListener\(\s*'url'/,
    );
  });

  it('…and it routes them through the same classifier the scanner uses', () => {
    // Scanned and linked payloads must not be able to diverge — same classifier, same handler.
    const chat = readFileSync(path.join(here, '..', 'src', 'screens', 'ChatScreen.js'), 'utf-8');
    expect(chat).toContain('getBasisClassifiers');
    expect(chat).toContain('onQrScanResult(classifyQrPayload');
  });
});
