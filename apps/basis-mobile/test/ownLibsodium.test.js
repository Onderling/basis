/**
 * OUR OWN LIBSODIUM (ledger L835): the phone links libsodium built from the pinned, verified source
 * (scripts/build-libsodium-android.sh, libsodium/PIN.json), never react-native-libsodium's prebuilt build.tgz. The pin
 * and the build agree with the app and with the package they replace a part of; when two places hold one fact, this
 * pins the agreement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';

const app = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(app, p), 'utf8');
const pin = JSON.parse(read('libsodium/PIN.json'));
const pkgDir = dirname(createRequire(resolve(app, 'package.json')).resolve('react-native-libsodium/package.json'));

describe('our own libsodium build', () => {
  it('the pin is complete: the source by SHA-256 and signature, the NDK, four libraries by SHA-256', () => {
    expect(pin.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pin.url).toMatch(/^https:\/\/download\.libsodium\.org\/libsodium\/releases\/libsodium-[\d.]+(-stable)?\.tar\.gz$/);
    expect(pin.minisignUrl).toBe(`${pin.url}.minisig`);
    expect(Object.keys(pin.abis).sort()).toEqual(['armv7-a', 'armv8-a', 'x86', 'x86_64']);
    for (const a of Object.values(pin.abis)) expect(a.soSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the pinned NDK is the app\'s own', () => {
    expect(read('android/build.gradle')).toContain(`ndkVersion = "${pin.ndk}"`);
  });

  it('the package it replaces a part of is the pinned one, and its CMake reads the directories this build writes', () => {
    expect(JSON.parse(read('package.json')).dependencies['react-native-libsodium']).toBe(pin.package.split('@').pop());
    const cmake = readFileSync(resolve(pkgDir, 'android/CMakeLists.txt'), 'utf8');
    for (const a of Object.values(pin.abis)) expect(cmake).toContain(a.dir);
  });

  it('the signing key is libsodium.org\'s, the same one the package ships', () => {
    expect(read(`libsodium/${pin.minisignPublicKeyFile}`)).toBe(readFileSync(resolve(pkgDir, 'libsodium/libsodium.org.minisign.pub'), 'utf8'));
  });

  it('gradle builds it before every module\'s preBuild, and the script refuses rather than skips', () => {
    const gradle = read('android/build.gradle');
    expect(gradle).toMatch(/tasks\.register\('buildOwnLibsodium', Exec\)/);
    expect(gradle).toMatch(/it\.name == 'preBuild' \}\.configureEach \{ dependsOn\(buildOwnLibsodium\) \}/);
    const sh = read('scripts/build-libsodium-android.sh');
    expect(sh).toMatch(/minisign is required/);
    expect(sh).toMatch(/is not the pinned one/);
    expect(sh).toMatch(/differs from the pinned/);
  });
});
