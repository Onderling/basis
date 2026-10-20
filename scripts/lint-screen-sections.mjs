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
});

/** What one shell's text lacks for a screen: the `sectionsOf` call, or a declared section id. */
export function missingIn(text, screen, ids) {
  const out = [];
  if (!new RegExp(`sectionsOf\\(\\s*['"]${screen}['"]\\s*\\)`).test(text)) out.push(`sectionsOf('${screen}')`);
  for (const id of ids) if (!new RegExp(`['"]${id}['"]`).test(text)) out.push(id);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { SCREEN_SECTIONS } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/screenSections.js')).href);
  const problems = [];
  for (const [screen, sections] of Object.entries(SCREEN_SECTIONS)) {
    const files = SCREEN_FILES[screen];
    if (!files) { problems.push(`${screen}: declared, but no files say where each shell paints it (SCREEN_FILES)`); continue; }
    for (const shell of ['web', 'mobile']) {
      const text = (files[shell] ?? []).map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
      for (const m of missingIn(text, screen, sections.map((s) => s.id))) problems.push(`${screen} · ${shell}: lacks ${m}`);
    }
  }
  if (problems.length) {
    console.error('lint-screen-sections:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-screen-sections: ${Object.keys(SCREEN_SECTIONS).length} declared screen(s) painted from their sections by web and mobile`);
}
