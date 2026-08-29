/**
 * GUARD — ask whether the native module is THERE before importing the JS that requires it.
 *
 * The background-task registration in the entry is already wrapped in try/catch, and the catch really does
 * run (its warn is in logcat). It still put a full-screen redbox on every launch of a dev client built
 * without `expo-task-manager` (2026-08-29, Samsung A33): a missing native module is reported by the NATIVE
 * layer, so catching the JS throw silences nothing a person can see. `requireOptionalNativeModule` answers
 * `null` instead of throwing, and nothing is reported.
 *
 * A redbox on every boot is not cosmetic here: it stacks new errors behind an old one, and a walk driving
 * the phone reads a minimised redbox as a blank screen — which cost three rounds the same day.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Every file that reaches for the OS background-task modules. Both pull in the native TaskManager. */
const FILES = ['../index.js', '../src/core/backgroundSync.js'];
const NATIVE_IMPORTS = ["import('expo-task-manager')", "import('expo-background-fetch')"];

describe('GUARD — the background task probes before it imports', () => {
  for (const rel of FILES) {
    it(`${rel} asks requireOptionalNativeModule before importing a native background module`, () => {
      const src = readFileSync(path.resolve(__dirname, rel), 'utf8');
      const first = NATIVE_IMPORTS.map((n) => src.indexOf(n)).filter((i) => i > -1).sort((a, b) => a - b)[0];
      if (first === undefined) return;                        // this file does not reach for one — fine
      const probe = src.indexOf('requireOptionalNativeModule');
      expect(
        probe > -1 && probe < first,
        `${rel} imports a native background module without probing first, so the native layer reports a `
        + 'redbox on every launch of a dev client that lacks it — the try/catch cannot suppress that',
      ).toBe(true);
    });
  }
});
