// The themed-input guard, watched failing on fixtures: a raw RN TextInput, a react-native TextInput import, and a web
// input rule with a background but no colour each fail it; the themed component itself and a fully themed rule pass.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GUARD = new URL('lint-themed-inputs.mjs', import.meta.url).pathname;
let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'themed-inputs-'));
  mkdirSync(join(root, 'apps/basis-mobile/src/screens/v2'), { recursive: true });
  mkdirSync(join(root, 'apps/basis/web/v2'), { recursive: true });
  writeFileSync(join(root, 'apps/basis-mobile/src/screens/v2/ThemedTextInput.js'), "import { TextInput } from 'react-native';\nexport default () => <TextInput />;\n");
  writeFileSync(join(root, 'apps/basis/web/v2/circle.css'), '.x-input { background: var(--paper); color: var(--ink); }\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const run = () => {
  try { return { code: 0, out: execFileSync('node', [GUARD], { encoding: 'utf8', env: { ...process.env, LINT_THEMED_INPUTS_ROOT: root } }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};
const screen = (body) => writeFileSync(join(root, 'apps/basis-mobile/src/screens/v2/Some.js'), body);

describe('every text input takes its colours from the theme', () => {
  it('passes the themed component itself and a screen that uses it', () => {
    screen("import ThemedTextInput from './ThemedTextInput.js';\nexport default () => <ThemedTextInput value=\"x\" />;\n");
    expect(run().code).toBe(0);
  });
  it('fails a raw RN TextInput, and a react-native TextInput import', () => {
    screen("import { View, TextInput } from 'react-native';\nexport default () => <TextInput value=\"x\" />;\n");
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/Some\.js: a raw <TextInput>/);
    expect(out).toMatch(/Some\.js: imports TextInput from react-native/);
  });
  it('is not fooled by a comment that mentions TextInput', () => {
    screen("// the TextInput stays mounted\nimport ThemedTextInput from './ThemedTextInput.js';\nexport default () => <ThemedTextInput />;\n");
    expect(run().code).toBe(0);
  });
  it('fails a web input rule that sets a background without a text colour', () => {
    writeFileSync(join(root, 'apps/basis/web/v2/circle.css'), '.y textarea { background: var(--paper); }\n.z-input { padding: 4px; }\n');
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/\.y textarea.*background but not its text colour/);
  });
});
