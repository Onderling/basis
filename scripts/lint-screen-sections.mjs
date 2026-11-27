#!/usr/bin/env node
/**
 * lint-screen-sections — a hand-painted screen whose sections are DECLARED (`apps/basis/src/v2/screenSections.js`) is
 * painted from that list by BOTH shells: each shell's file asks for the screen's sections (`sectionsOf('<screen>')`)
 * and names a painter for every declared section id. Red when a shell lacks one — the shape of the five gaps the
 * buttons assessment found (2026-10-19), where one shell painted a section the other did not and nothing noticed.
 *
 * Sections and actions only: how a shell lays a section out is its own.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { whereIn } from './guard-where.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where each declared screen is painted, per shell. A declared screen with no entry here is red too. */
export const SCREEN_FILES = Object.freeze({
  adminPanel: {
    web: ['apps/basis/web/v2/circleAdminPanel.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/CircleAdminPanelScreen.js'],
  },
  memberCard: {
    web: ['apps/basis/web/v2/circleMemberCard.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/CircleMemberCardScreen.js'],
  },
  fileBubble: {
    web: ['apps/basis/web/v2/contactThread.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/ContactThreadScreen.js'],
  },
  governanceProposal: {
    web: ['apps/basis/web/v2/circleGovernancePanel.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/CircleGovernanceScreen.js'],
  },
  vandaagCustomise: {
    web: ['apps/basis/web/v2/vandaagCustomise.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/VandaagCustomiseModal.js'],
  },
  plusSheet: {
    web: ['apps/basis/web/v2/vandaagPlus.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/VandaagPlusModal.js'],
  },
  // Nearby's two tabs: the shells ask `nearbyTabs(model)` (which reads both declared lists and drops the empty parts)
  // instead of `sectionsOf` directly — `via` names that call.
  nearbyConversation: {
    web: ['apps/basis/web/v2/circleNearby.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js'],
    via: 'nearbyTabs',
  },
  nearbyQuestions: {
    web: ['apps/basis/web/v2/circleNearby.js'],
    mobile: ['apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js'],
    via: 'nearbyTabs',
  },
});

/** What one shell's text lacks for a screen: the `sectionsOf` call (or the shared function `via` that reads the list
 *  for it), or a declared section id. */
export function missingIn(text, screen, ids, via = null) {
  const out = [];
  if (via) { if (!new RegExp(`\\b${via}\\(`).test(text)) out.push(`${via}(`); }
  else if (!new RegExp(`sectionsOf\\(\\s*['"]${screen}['"]\\s*\\)`).test(text)) out.push(`sectionsOf('${screen}')`);
  for (const id of ids) if (!new RegExp(`['"]${id}['"]`).test(text)) out.push(id);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { SCREEN_SECTIONS } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/screenSections.js')).href);
  const problems = [];
  for (const [screen, sections] of Object.entries(SCREEN_SECTIONS)) {
    const files = SCREEN_FILES[screen];
    if (!files) { problems.push(`${whereIn('apps/basis/src/v2/screenSections.js', screen)}: ${screen} is declared, but no files say where each shell paints it.\n    Fix: add a SCREEN_FILES row for it in ${path.relative(ROOT, fileURLToPath(import.meta.url))} ({ web: [...], mobile: [...] }).`); continue; }
    for (const shell of ['web', 'mobile']) {
      const text = (files[shell] ?? []).map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
      for (const m of missingIn(text, screen, sections.map((s) => s.id), files.via ?? null)) {
        problems.push(`${(files[shell] ?? []).join(', ') || '(no file)'}: ${screen} · ${shell} lacks ${m} (the file holds no such text, so there is no line to name).\n    Fix: paint the screen from ${files.via ? `${files.via}(…)` : `sectionsOf('${screen}')`} instead of a hand-made list, so every declared section is there.`);
      }
    }
  }
  if (problems.length) {
    console.error('✖ lint-screen-sections:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-screen-sections: ${Object.keys(SCREEN_SECTIONS).length} declared screen(s) painted from their sections by web and mobile`);
}
