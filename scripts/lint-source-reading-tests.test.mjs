import { describe, it, expect } from 'vitest';
import { untaggedSourceReads, needsNoTag } from './lint-source-reading-tests.mjs';

const read = (p) => `const src = readFileSync(fileURLToPath(new URL('${p}', import.meta.url)), 'utf8');`;

describe('lint-source-reading-tests', () => {
  it('a test outside test/fitness that reads a source file as text, untagged, is named with the line of the read', () => {
    const text = `import { it } from 'vitest';\n\n${read('../src/screens/v2/CircleLauncherScreen.js')}\n`;
    expect(untaggedSourceReads('apps/basis-mobile/test/x.test.js', text)).toEqual([{ line: 3 }]);
  });

  it('a template path into src/ counts too', () => {
    const text = 'const s = readFileSync(fileURLToPath(new URL(`../src/screens/v2/${name}`, import.meta.url)), "utf8");';
    expect(untaggedSourceReads('apps/basis-mobile/test/y.test.js', text)).toEqual([{ line: 1 }]);
  });

  it('the tag clears it', () => {
    const text = `// @reads-source\n${read('../src/a.js')}`;
    expect(untaggedSourceReads('apps/basis/test/z.test.js', text)).toEqual([]);
  });

  it('reading a fixture or a JSON file is not reading source', () => {
    const text = `${read('./fixtures/ledger.md')}\n${read('../package.json')}\nreadFileSync(tmpFile, 'utf8');`;
    expect(untaggedSourceReads('apps/basis/test/w.test.js', text)).toEqual([]);
  });

  it('a relay or box test that only SPAWNS a script is not reading it (those run on rung 2); a read line still counts', () => {
    const spawnOnly = "const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));\nreadFileSync(logFile, 'utf8');";
    expect(untaggedSourceReads('apps/basis/test/walk.relay.test.js', spawnOnly)).toEqual([]);
    expect(untaggedSourceReads('apps/basis/test/token.box.test.js', spawnOnly)).toEqual([]);
    const reads = "const s = readFileSync(new URL('../src/a.js', import.meta.url), 'utf8');";
    expect(untaggedSourceReads('apps/basis/test/walk.relay.test.js', reads)).toEqual([{ line: 1 }]);
  });

  it('the closing line of a multi-line import is not a read', () => {
    const text = "import {\n  a,\n} from './support/pairRealAgents.js';\nreadFileSync(tmp, 'utf8');";
    expect(untaggedSourceReads('apps/basis/test/m.test.js', text)).toEqual([]);
  });

  it('a path named in a comment is not a read', () => {
    const text = "/**\n * The real box (`bin/device-runner.mjs`) boots.\n */\n// see src/a.js\nreadFileSync(tmp, 'utf8');";
    expect(untaggedSourceReads('apps/basis/test/c.test.js', text)).toEqual([]);
  });

  it('test/fitness, *Parity tests and the guards\' self-tests already run in rung 1', () => {
    expect(needsNoTag('apps/basis/test/fitness/a.test.js')).toBe(true);
    expect(needsNoTag('apps/basis-mobile/test/localeParity.test.js')).toBe(true);
    expect(needsNoTag('scripts/lint-x.test.mjs')).toBe(true);
    expect(needsNoTag('apps/basis/test/v2/a.test.js')).toBe(false);
  });
});
