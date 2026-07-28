/**
 * @onderling/app-scaffold — v0.
 *
 * A PURE manifest→app scaffolder. Given an app `manifest` (the `{ operations:
 * [{ id, verb, params, appliesTo, surfaces, … }] }` contract) and a `requires`
 * list drawn from 's capability vocabulary, it:
 *
 *   1. VALIDATES the `requires` via `@onderling/sdk/requires` `validateRequires`.
 *      An unknown capability → a coded throw (`ERR_APP_SCAFFOLD_INVALID_REQUIRES`)
 *      and NOTHING is scaffolded. This is why was gated on.
 *   2. GENERATES a runnable app skeleton as a `{ <path>: <content> }` map:
 *        - `package.json` — name `@onderling-app/<appId>`, `type: module`, a test
 *          script, `@onderling/sdk` as the dependency, and a `onderling` block that
 *          records the requires + the per-capability SDK sub-path import
 *          specifiers (: core→/core, transports→/transports, vault→/vault,
 *          pod→/pod, high→the barrel `@onderling/sdk`).
 *        - `src/index.js` — the entry: imports `createAgent` from
 *          `@onderling/sdk/high` + `wireSkill` from `@onderling/sdk`, and for EACH
 *          `manifest.operations[]` op wires a `wireSkill(<op>Core, opById('<id>'),
 *          { storeFor })` stub (a TODO-bodied core fn per op) registered on the
 *          agent. A runnable skeleton a dev fills in.
 *        - `manifest.js` — a re-export/stub of the provided manifest (or a
 *          minimal starter when none is given).
 *        - `README.md` — a minimal stub per the app-readme scheme.
 *
 * PURE: `scaffoldApp` returns strings. If a `writer({ path, content })` is
 * injected it is ALSO called for each file (side effect on top of the pure
 * core), so the same result can be written to disk without the core knowing
 * about a filesystem.
 *
 * BOUNDED (v0): scaffolds the CORE skeleton only. Deferred + reported in
 * `warnings`: full multi-surface / mobile scaffolding, the projector wiring
 * (renderChat/renderSlash/renderGate/renderWeb/renderMobile), and the test
 * scaffolding.
 */

import { validateRequires, CAPABILITIES } from '@onderling/sdk/requires';

/** Stable error code for a `requires` that fails validation. */
export const APP_SCAFFOLD_CODES = Object.freeze({
  INVALID_REQUIRES: 'ERR_APP_SCAFFOLD_INVALID_REQUIRES',
});

/**
 * capability → the SDK import specifier the scaffolded app should use.
 * Every specifier resolves to the single `@onderling/sdk` package (sub-path
 * exports), so the npm dependency is always just `@onderling/sdk`; this map is
 * what the generated code IMPORTS and what `package.json.onderling.sdkImports`
 * records per requested capability.
 *
 *   - core       → @onderling/sdk/core
 *   - transports → @onderling/sdk/transports
 *   - vault      → @onderling/sdk/vault
 *   - pod        → @onderling/sdk/pod
 *   - high       → @onderling/sdk   (the barrel re-exports the /high slice, so the
 *                                 opinionated helpers import from the barrel)
 */
export const CAPABILITY_SDK_IMPORT = Object.freeze({
  core:       '@onderling/sdk/core',
  transports: '@onderling/sdk/transports',
  vault:      '@onderling/sdk/vault',
  pod:        '@onderling/sdk/pod',
  high:       '@onderling/sdk',
});

/**
 * Scaffold a runnable app skeleton from a manifest + a requires list.
 *
 * @param {object}   args
 * @param {object}   [args.manifest]  the app manifest (`{ operations: [...] }`);
 *                                     when omitted a minimal starter is emitted.
 * @param {string[]} args.requires capability list (validated).
 * @param {string}   args.appId       app id → package name `@onderling-app/<appId>`.
 * @param {(file: {path: string, content: string}) => void} [args.writer]
 *                                     optional side-effect sink (also written).
 * @returns {{ files: Record<string,string>, warnings: string[] }}
 * @throws {Error & {code: string, unknown: Array}} on an unknown capability.
 */
export function scaffoldApp({ manifest, requires, appId, writer } = {}) {
  if (typeof appId !== 'string' || appId.length === 0) {
    throw new TypeError('scaffoldApp: `appId` must be a non-empty string');
  }
  if (!Array.isArray(requires)) {
    throw new TypeError('scaffoldApp: `requires` must be an array of capability names');
  }

  // 1 ── validate requires via. Unknown → coded throw, no files.
  const result = validateRequires(requires);
  if (!result.ok) {
    // v0 scaffolds against the vocabulary only (no `available` set is passed),
    // so the only way to fail is an UNKNOWN capability.
    const bad = result.unknown.map((u) => u.capability);
    const err = new Error(
      `scaffoldApp: unknown capabilit${bad.length === 1 ? 'y' : 'ies'} in requires: ${bad.join(', ')}. `
      + `Known capabilities: ${CAPABILITIES.join(', ')}.`,
    );
    err.code = APP_SCAFFOLD_CODES.INVALID_REQUIRES;
    err.unknown = result.unknown;
    throw err;
  }

  const warnings = [];

  // A stable, de-duplicated view of the requires (order preserved).
  const caps = [...new Set(requires)];

  // 2 ── generate the skeleton.
  const operations = Array.isArray(manifest?.operations) ? manifest.operations : [];
  if (!manifest) {
    warnings.push('No `manifest` supplied — emitted a minimal starter manifest.js with an empty operations[].');
  } else if (operations.length === 0) {
    warnings.push('`manifest.operations` is empty — src/index.js wires createAgent with no skills.');
  }

  const files = {
    'package.json': genPackageJson({ appId, caps }),
    'manifest.js':  genManifest({ manifest, appId }),
    'src/index.js': genIndex({ operations, appId }),
    'README.md':    genReadme({ appId, caps, operations }),
  };

  // v0 bounded-scope deferrals (reported, not generated).
  warnings.push('DEFERRED: multi-surface / mobile scaffolding (only the shared createAgent entry is generated).');
  warnings.push('DEFERRED: projector wiring (renderChat/renderSlash/renderGate/renderWeb/renderMobile).');
  warnings.push('DEFERRED: test scaffolding (no vitest config / test files generated for the app).');
  warnings.push('README.md is a minimal stub — flesh out the honest phase table per docs/conventions/app-readme-scheme.md.');

  // Optional side-effect sink.
  if (typeof writer === 'function') {
    for (const [path, content] of Object.entries(files)) {
      writer({ path, content });
    }
  } else if (writer !== undefined) {
    throw new TypeError('scaffoldApp: `writer` must be a function when given');
  }

  return { files, warnings };
}

export default scaffoldApp;

// ── codegen helpers ─────────────────────────────────────────────────────────

/** `@onderling-app/<appId>` package.json with requires-derived SDK metadata. */
function genPackageJson({ appId, caps }) {
  const sdkImports = {};
  for (const cap of caps) sdkImports[cap] = CAPABILITY_SDK_IMPORT[cap];

  const pkg = {
    name:    `@onderling-app/${appId}`,
    version: '0.1.0',
    type:    'module',
    main:    'src/index.js',
    scripts: {
      test: 'vitest run',
    },
    dependencies: {
      // Every requested capability resolves to the single @onderling/sdk package
      // via its sub-path exports, so the dependency is @onderling/sdk regardless
      // of which slices are requested. The per-capability import specifiers
      // live under `onderling.sdkImports`.
      '@onderling/sdk': '^0.1.0',
    },
    devDependencies: {
      vitest: '^3.0.0',
    },
    onderling: {
      scaffold:   '@onderling/app-scaffold@0.1.0',
      requires:   caps,
      sdkImports,
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

/** Re-export the provided manifest verbatim, or a minimal starter. */
function genManifest({ manifest, appId }) {
  if (manifest) {
    const json = JSON.stringify(manifest, null, 2);
    return (
      `/**\n`
      + ` * ${appId} — app manifest (scaffolded from the supplied manifest).\n`
      + ` *\n`
      + ` * The manifest is the single contract for every surface. Edit here.\n`
      + ` */\n`
      + `export const manifest = ${json};\n\n`
      + `export default manifest;\n`
    );
  }
  const starter = {
    app:        appId,
    itemTypes:  [],
    operations: [],
    views:      [],
  };
  return (
    `/**\n`
    + ` * ${appId} — minimal starter manifest (no manifest was supplied).\n`
    + ` *\n`
    + ` * Add operations: [{ id, verb, appliesTo, params, surfaces }] — the\n`
    + ` * manifest is the single contract for every surface.\n`
    + ` */\n`
    + `export const manifest = ${JSON.stringify(starter, null, 2)};\n\n`
    + `export default manifest;\n`
  );
}

/** Turn an op id into a safe JS identifier for its core-fn name. */
function coreFnName(id) {
  const safe = String(id).replace(/[^A-Za-z0-9_$]/g, '_');
  const base = /^[A-Za-z_$]/.test(safe) ? safe : `_${safe}`;
  return `${base}Core`;
}

/**
 * The entry module: createAgent (from @onderling/sdk/high) + one wireSkill stub
 * per manifest operation, registered on the agent.
 */
function genIndex({ operations, appId }) {
  const stubs = operations.map((op) => {
    const fn   = coreFnName(op.id);
    const verb = op.verb ? String(op.verb) : '(unspecified)';
    const type = op.appliesTo?.type ? String(op.appliesTo.type) : 'n/a';
    return (
      `/**\n`
      + ` * ${op.id} — verb '${verb}', appliesTo.type '${type}'.\n`
      + ` * TODO(${op.id}): implement. \`store\` comes from storeFor(ctx); \`args\`\n`
      + ` * is decoded + validated against the manifest op's declared params.\n`
      + ` */\n`
      + `async function ${fn}(store, args, ctx) {\n`
      + `  throw new Error('${op.id}: not implemented (scaffold stub)');\n`
      + `}`
    );
  }).join('\n\n');

  const skillEntries = operations.map((op) => {
    const fn = coreFnName(op.id);
    return `    { name: ${JSON.stringify(op.id)}, handler: wireSkill(${fn}, opById(${JSON.stringify(op.id)}), { storeFor }) },`;
  }).join('\n');

  return (
    `/**\n`
    + ` * ${appId} — scaffolded entry (generated by @onderling/app-scaffold v0).\n`
    + ` *\n`
    + ` * Every manifest operation is wired as a wireSkill(coreFn, op, { storeFor })\n`
    + ` * stub registered on a createAgent()-built agent. Fill in each *Core below.\n`
    + ` */\n`
    + `import { createAgent } from '@onderling/sdk/high';\n`
    + `import { wireSkill }   from '@onderling/sdk';\n`
    + `import manifest        from '../manifest.js';\n`
    + `\n`
    + `/**\n`
    + ` * storeFor — resolve the per-scope store for a skill invocation from the\n`
    + ` * skill context (e.g. ctx.from / ctx.envelope). Multi-scope state lives\n`
    + ` * OUTSIDE the single agent (CLAUDE.md invariant #6). TODO: wire this.\n`
    + ` */\n`
    + `const storeFor = (ctx) => {\n`
    + `  // TODO: return the per-scope store for this ctx (e.g. storesByScope.get(ctx.from)).\n`
    + `  return null;\n`
    + `};\n`
    + `\n`
    + `/** Look a manifest operation up by id (the wireSkill contract). */\n`
    + `const opById = (id) => manifest.operations.find((o) => o.id === id);\n`
    + `\n`
    + (stubs ? `${stubs}\n\n` : '')
    + `/**\n`
    + ` * start — build + start the app agent with every manifest op wired.\n`
    + ` * @param {object} [opts] forwarded to createAgent (identity/vault/transport/…).\n`
    + ` * @returns {Promise<import('@onderling/sdk/core').Agent>}\n`
    + ` */\n`
    + `export async function start(opts = {}) {\n`
    + `  return createAgent({\n`
    + `    ...opts,\n`
    + `    skills: [\n`
    + (skillEntries ? `${skillEntries}\n` : '')
    + `    ],\n`
    + `  });\n`
    + `}\n`
    + `\n`
    + `export { manifest };\n`
    + `export default start;\n`
  );
}

/** A minimal README stub per the app-readme scheme (fleshing out deferred). */
function genReadme({ appId, caps, operations }) {
  return (
    `# @onderling-app/${appId}\n`
    + `\n`
    + `> Scaffolded by \`@onderling/app-scaffold\` (SP-10 v0). This is a runnable skeleton — fill in the per-op cores in \`src/index.js\`.\n`
    + `\n`
    + `## Built on\n`
    + `\n`
    + `- \`@onderling/sdk\` — requires: ${caps.map((c) => `\`${c}\``).join(', ')}.\n`
    + `\n`
    + `## Operations (${operations.length})\n`
    + `\n`
    + (operations.length
        ? operations.map((op) => `- \`${op.id}\` — verb \`${op.verb ?? '?'}\` (stub in \`src/index.js\`).`).join('\n') + '\n'
        : '_None declared in the manifest yet._\n')
    + `\n`
    + `## Honest phase table\n`
    + `\n`
    + `| Area | State |\n`
    + `| --- | --- |\n`
    + `| Core skill wiring | scaffolded stubs (not implemented) |\n`
    + `| Surfaces / mobile | deferred |\n`
    + `| Projectors | deferred |\n`
    + `| Tests | deferred |\n`
    + `\n`
    + `See \`docs/conventions/app-readme-scheme.md\` and flesh this out.\n`
  );
}
