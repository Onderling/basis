#!/usr/bin/env node
/**
 * lint-screen-pairing-door — a shell reaches a screen's grant only through the shared pairing, never by itself.
 *
 * A screen pairs by showing its own throwaway offer; the person pastes or scans it and must PICK, from three, the code
 * their screen shows (the screen door, `apps/basis/src/v2/screenDoor.js`). The pick is the person's check that the
 * offer is from THEIR screen: a planted offer ("paste this") yields a code they cannot find on any screen of theirs. The
 * code is not a secret, so the op cannot enforce the pick; the pairing does (`appScreenPairing.js`), and this guard
 * keeps the shells from going around it: no shell file names the grant op or reads an offer itself. (Before 2026-11-15
 * both shells parsed the offer and called the grant straight from the ticks, with no pick at all.)
 *
 * The household bot's door is not a shell's: it lives in shared code (`botScreens.js`) and the box composes it.
 */
import { execSync, execFileSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
// what a shell paints and composes: web, the phone (the box has no pairing UI)
const PATHS = ['apps/basis/web', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];
// the grant op named, or an offer read / a grant compiled outside the shared pairing
const PATTERN = `['"]grantSurface['"]|parsePairingOffer|compileConnectionGrant`;

let hits = '';
try {
  // no shell between: the pattern holds quotes
  hits = execFileSync('git', ['grep', '-nE', PATTERN, '--'].concat(PATHS), { cwd: ROOT, encoding: 'utf8' }).trim();
} catch (err) {
  if (err.status !== 1) throw err;   // 1 = no match
}
if (hits) {
  console.error('lint-screen-pairing-door: a shell reaches a screen\'s grant without the shared pairing (the code pick):');
  console.error(hits);
  console.error('Use createAppScreenPairing (apps/basis/src/v2/appScreenPairing.js): offer → pick → grant.');
  process.exit(1);
}
console.log('lint-screen-pairing-door: ok (the shells pair screens only through the shared pairing)');
