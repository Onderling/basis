/**
 * Every tab the manifest declares has a handler on BOTH shells. The tab bar projects from
 * `manifest.tabs[]` on web and mobile by construction — but what a tab DOES is still a per-shell map
 * (web: the `handlers` object in circleTabBar.js fed by showTabBar; mobile: the `onTab` branches). A tab
 * declared without a handler renders and does nothing — the Nearby screen sat unreachable behind exactly
 * that gap until 2026-08-30. Shell files have no runtime coverage, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { basisManifest } from '../../manifest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
const TAB_IDS = (basisManifest.tabs ?? []).map((t) => t.id);

describe('every declared tab has a door on both shells', () => {
  it('declares the tabs a person can stand on', () => {
    expect(TAB_IDS).toContain('nearby');
  });
  it('web: circleTabBar maps every tab id to a handler, and showTabBar passes one', () => {
    const bar = read('../../web/v2/circleTabBar.js');
    const app = read('../../web/v2/circleApp.js');
    const handlersLine = bar.match(/const handlers = \{([^}]*)\}/)?.[1] ?? '';
    for (const id of TAB_IDS) {
      expect(handlersLine, `web tab bar has no handler slot for "${id}"`).toMatch(new RegExp(`\\b${id}:\\s*on\\w+`));
      const prop = handlersLine.match(new RegExp(`\\b${id}:\\s*(on\\w+)`))?.[1];
      const showTabBar = app.slice(app.indexOf('function showTabBar('), app.indexOf('function showTabBar(') + 600);
      expect(showTabBar, `showTabBar does not pass "${prop}" for tab "${id}"`).toMatch(new RegExp(`\\b${prop}:\\s*\\w+`));
    }
  });
  it('mobile: onTab has a branch for every tab id', () => {
    const src = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
    const onTab = src.slice(src.indexOf('const onTab = (id) => {'), src.indexOf('const onTab = (id) => {') + 800);
    for (const id of TAB_IDS) expect(onTab, `mobile onTab has no branch for "${id}"`).toMatch(new RegExp(`id === '${id}'`));
  });
});
