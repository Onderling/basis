/**
 * Contacts and Me on the phone (web twin: apps/basis/test/v2/contactsMijSweep.dom.test.js): "Persoon toevoegen" opens
 * Me's Scan; the row line is the shared one (trust as its word); Me without a handle says "Nog geen naam"; the agents
 * rows are plain lines; "this device" gets the phone's own name. RN cannot render under Vitest, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f) => readFileSync(resolve(__dirname, `../src/screens/v2/${f}`), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const contacts = read('ContactsScreen.js');
const launcher = read('CircleLauncherScreen.js');
const view = read('CircleScreenView.js');
const profile = read('CircleProfileScreen.js');

describe('Contacts and Me on the phone', () => {
  it('Persoon toevoegen opens the scanner (Me\'s Scan, one door)', () => {
    expect(contacts).toMatch(/testID="contacts-add-person"/);
    expect(contacts).toMatch(/t\('circle\.contacts\.add_person'\)/);
    expect(launcher).toMatch(/onAddPerson=\{\(\) => onMeAction\('scan'\)\}/);
  });
  it('the row line is the shared one', () => {
    expect(contacts).toMatch(/contactRowMeta\(c, t\)/);
    expect(contacts).not.toMatch(/function rosterMeta/);
  });
  it('Me: "Nog geen naam"; agents rows plain; this device by the phone\'s name', () => {
    expect(view).toMatch(/block\.content\?\.name \|\| t\('circle\.profile\.no_name_yet'\)/);
    expect(view).toMatch(/style=\{styles\.agentRow\} testID=\{`mij-agent-/);
    expect(launcher).toMatch(/deviceName: \(\) => Constants\.deviceName \?\? null/);
    expect(profile).toMatch(/deviceName: \(\(\) => \{ try \{ return sources\.deviceName\?\.\(\)/);
  });
});
