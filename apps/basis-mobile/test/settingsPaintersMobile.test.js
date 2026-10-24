/**
 * The settings painters on mobile paint ITS section and nothing else, and the old My data page keeps every section no
 * group took, in its order. `src/screens/**` cannot be rendered under vitest, so the paint is pinned as source text (as
 * meSubscreensChrome does): the section titles each painter opens, and the old page's, in order.
 *
 * Why: the first cut of the Weergave group (2026-10-23) took mobile's week switch up to "where the app opens", and on
 * mobile nine sections sat between — Waar het staat, Sleutels & back-up, Mijn apparaten and more. They left the old
 * page and showed on the Weergave screen instead, custody among them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleMyDataScreen.js', import.meta.url)), 'utf8');
const titles = (text) => [...text.matchAll(/<Section title=\{t\('([^']+)'\)\}/g)].map((m) => m[1]);

/** Each section id the Weergave group declares, and the one title its painter opens. */
const OWN_TITLE = {
  'theme': 'circle.mydata.theme',
  'language': 'circle.mydata.language',
  'start-screen': 'circle.mydata.start_title',
  'bot-actions': 'circle.mydata.surface_pref',
  'week-overview': 'circle.profile.week_switch',
  'notifications': 'circle.mydata.notifications',
  'assistant': 'circle.userLlm.title',
};

const painterBodies = () => {
  const start = SRC.indexOf('const painters = {');
  const block = SRC.slice(start, SRC.indexOf('\n  };\n', start));
  const heads = [...block.matchAll(/^ {4}'([a-z0-9-]+)': \(\) =>/gm)];
  return Object.fromEntries(heads.map((m, i) => [m[1], block.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : block.length)]));
};

describe('mobile settings painters', () => {
  it('each painter opens exactly its own section, and no other', () => {
    const bodies = painterBodies();
    for (const [id, title] of Object.entries(OWN_TITLE)) expect(titles(bodies[id] ?? ''), id).toEqual([title]);
  });

  it('the old My data page keeps every other section, in its order', () => {
    const page = SRC.slice(SRC.indexOf('  return (\n    <ScrollView style={styles.wrap}'));
    expect(titles(page)).toEqual([
      'circle.profile.mydata_more', 'circle.mydata.storage', 'circle.mydata.keys', 'circle.mydata.devices',
      'circle.companionGrant.nodes', 'circle.mydata.connections', 'circle.mydata.connection_add', 'circle.mydata.sync',
      'circle.mydata.address_sharing', 'circle.mydata.cleanup', 'circle.mydata.history', 'circle.mydata.privacy',
      'circle.mydata.frequent', 'circle.mydata.usage',
    ]);
  });
});
