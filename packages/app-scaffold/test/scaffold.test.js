import { describe, it, expect } from 'vitest';
import { scaffoldApp, APP_SCAFFOLD_CODES, CAPABILITY_SDK_IMPORT } from '../src/index.js';

/** Count real `wireSkill(<fn>, opById(...))` wiring lines (not the doc mention). */
const countWirings = (src) => (src.match(/wireSkill\([A-Za-z0-9_$]+, opById\(/g) || []).length;

/** Strip ESM import/export syntax so the body can be parse-checked by `new Function`. */
const toParseable = (src) => src
  .split('\n')
  .filter((l) => !/^\s*import\s/.test(l))
  .join('\n')
  .replace(/^export default .*$/gm, '')
  .replace(/^export \{[^}]*\};?\s*$/gm, '')
  .replace(/^export (async function|function|const|class|let) /gm, '$1 ');

/**
 * A small real-shaped manifest (mined from apps/tasks-v0/manifest.js's op
 * pattern): id / verb / appliesTo / params / surfaces.
 */
const sampleManifest = {
  app: 'demo',
  itemTypes: ['task'],
  operations: [
    {
      id: 'addTask', verb: 'add', appliesTo: { type: 'task' },
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: { chat: { hint: 'Create a task.' } },
    },
    {
      id: 'listOpen', verb: 'list', appliesTo: { type: 'task' },
      params: [],
      surfaces: { chat: { hint: 'List open tasks.' } },
    },
    {
      id: 'completeTask', verb: 'complete', appliesTo: { type: 'task', state: ['claimed'] },
      params: [{ name: 'id', kind: 'string', required: true }],
      surfaces: { ui: { control: 'button', label: 'Mark complete' } },
    },
  ],
};

describe('scaffoldApp — happy path', () => {
  const { files, warnings } = scaffoldApp({
    manifest: sampleManifest,
    requires: ['core', 'high', 'pod'],
    appId: 'demo',
  });

  it('emits the four core files', () => {
    expect(Object.keys(files).sort()).toEqual(
      ['README.md', 'manifest.js', 'package.json', 'src/index.js'],
    );
  });

  it('package.json is valid JSON, named @onderling-app/<appId>, deps on @onderling/sdk', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).toBe('@onderling-app/demo');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.test).toBeTruthy();
    expect(pkg.dependencies['@onderling/sdk']).toBeTruthy();
  });

  it('package.json carries the right SDK sub-path deps for the requires', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.onderling.requires).toEqual(['core', 'high', 'pod']);
    expect(pkg.onderling.sdkImports).toEqual({
      core: '@onderling/sdk/core',
      high: '@onderling/sdk',
      pod:  '@onderling/sdk/pod',
    });
    // high maps to the barrel; pod maps to the /pod sub-path.
    expect(pkg.onderling.sdkImports.pod).toBe(CAPABILITY_SDK_IMPORT.pod);
  });

  it('src/index.js imports createAgent from @onderling/sdk/high + wireSkill', () => {
    const idx = files['src/index.js'];
    expect(idx).toContain("import { createAgent } from '@onderling/sdk/high'");
    expect(idx).toMatch(/import \{ wireSkill \}\s+from '@onderling\/sdk'/);
  });

  it('src/index.js contains a wireSkill(... op ...) line per declared operation', () => {
    const idx = files['src/index.js'];
    for (const op of sampleManifest.operations) {
      expect(idx).toContain(`opById(${JSON.stringify(op.id)})`);
      expect(idx).toMatch(new RegExp(`wireSkill\\([A-Za-z0-9_$]+, opById\\(${JSON.stringify(op.id)}\\), \\{ storeFor \\}\\)`));
    }
    expect(countWirings(idx)).toBe(sampleManifest.operations.length);
  });

  it('generated src/index.js is syntactically valid (Function-constructible)', () => {
    // A parse-only check: new Function throws a SyntaxError on malformed JS.
    expect(() => new Function(toParseable(files['src/index.js']))).not.toThrow();
  });

  it('generated manifest.js parses + re-exports the manifest', () => {
    const m = files['manifest.js'];
    expect(m).toContain('export const manifest =');
    expect(m).toContain('export default manifest;');
    expect(() => new Function(toParseable(m))).not.toThrow();
  });

  it('reports deferred scope in warnings', () => {
    expect(warnings.join('\n')).toMatch(/DEFERRED: multi-surface/);
    expect(warnings.join('\n')).toMatch(/DEFERRED: projector wiring/);
    expect(warnings.join('\n')).toMatch(/DEFERRED: test scaffolding/);
  });
});

describe('scaffoldApp — requires validation (SP-9 gate)', () => {
  it('an unknown capability → a coded throw, no files', () => {
    let thrown;
    try {
      scaffoldApp({ manifest: sampleManifest, requires: ['core', 'blockchain'], appId: 'demo' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe(APP_SCAFFOLD_CODES.INVALID_REQUIRES);
    expect(thrown.unknown.map((u) => u.capability)).toContain('blockchain');
  });

  it('every SP-9 capability is accepted', () => {
    const { files } = scaffoldApp({
      manifest: sampleManifest,
      requires: ['core', 'transports', 'vault', 'pod', 'high'],
      appId: 'demo',
    });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.onderling.sdkImports).toEqual({
      core:       '@onderling/sdk/core',
      transports: '@onderling/sdk/transports',
      vault:      '@onderling/sdk/vault',
      pod:        '@onderling/sdk/pod',
      high:       '@onderling/sdk',
    });
  });
});

describe('scaffoldApp — no manifest → minimal starter', () => {
  it('emits a starter manifest + a warning, zero skills', () => {
    const { files, warnings } = scaffoldApp({ requires: ['core', 'high'], appId: 'blank' });
    const m = files['manifest.js'];
    expect(m).toContain('"operations": []');
    expect(files['src/index.js']).toContain('skills: [');
    expect(countWirings(files['src/index.js'])).toBe(0);
    expect(warnings.join('\n')).toMatch(/No `manifest` supplied/);
  });
});

describe('scaffoldApp — injected writer', () => {
  it('writes the same files it returns', () => {
    const written = {};
    const { files } = scaffoldApp({
      manifest: sampleManifest,
      requires: ['core', 'high', 'pod'],
      appId: 'demo',
      writer: ({ path, content }) => { written[path] = content; },
    });
    expect(written).toEqual(files);
  });

  it('rejects a non-function writer', () => {
    expect(() => scaffoldApp({
      manifest: sampleManifest, requires: ['core'], appId: 'demo', writer: 'nope',
    })).toThrow(TypeError);
  });
});
