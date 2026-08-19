import { describe, it, expect } from 'vitest';
import { loadRecipe, validateRecipe, RECIPE_CODES, ISSUE_CODES } from '../src/index.js';

// A well-formed recipe: valid registry nouns (task/note), SDK atoms, a freedom
// template row, an "<app>.<key>" setting, and a surface layout.
function goodRecipe() {
  return {
    name: 'Circle starter',
    version: '1.0.0',
    capabilities: {
      task: { atoms: ['add', 'list', 'complete'] },
      note: { atoms: ['add', 'remove'] },
    },
    freedoms: {
      'stoop add task': { enabled: true, freedom: 'optional', consequence: 'greyed' },
      'stoop complete task': { enabled: false },
    },
    settings: {
      'stoop.digestFrequency': 'weekly',
      'household.remindersOn': true,
    },
    surfaces: {
      features: { chat: true, tasks: true, calendar: false },
      view: 'screen',
    },
  };
}

describe('loadRecipe — happy path (object source, no verify)', () => {
  it('loads, validates, normalises, and marks unverified', async () => {
    const res = await loadRecipe(goodRecipe());
    expect(res.error).toBeUndefined();
    expect(res.warnings).toContain('unverified');
    // normalised bundle carries all four sections
    expect(res.recipe.capabilities.task.atoms).toEqual(['add', 'list', 'complete']);
    expect(res.recipe.freedoms['stoop complete task']).toEqual({ enabled: false });
    expect(res.recipe.settings['stoop.digestFrequency']).toBe('weekly');
    expect(res.recipe.surfaces).toEqual({ features: { chat: true, tasks: true, calendar: false }, view: 'screen' });
    expect(res.recipe.name).toBe('Circle starter');
  });
});

describe('loadRecipe — JSON string + injected fetch', () => {
  it('parses a JSON string source', async () => {
    const res = await loadRecipe(JSON.stringify(goodRecipe()));
    expect(res.error).toBeUndefined();
    expect(res.recipe.capabilities.note.atoms).toEqual(['add', 'remove']);
  });

  it('fetches a URL source through the injected fetch (offline)', async () => {
    const fetch = async (url) => {
      expect(url).toBe('https://example.org/recipe.json');
      return JSON.stringify(goodRecipe());       // plain-string fetch result
    };
    const res = await loadRecipe('https://example.org/recipe.json', { fetch });
    expect(res.error).toBeUndefined();
    expect(res.recipe.surfaces.view).toBe('screen');
  });

  it('accepts a Response-like fetch result ({ text() })', async () => {
    const fetch = async () => ({ text: async () => JSON.stringify(goodRecipe()) });
    const res = await loadRecipe('https://example.org/recipe.json', { fetch });
    expect(res.error).toBeUndefined();
  });

  it('URL source with no fetch injected → no-fetch error', async () => {
    const res = await loadRecipe('https://example.org/recipe.json');
    expect(res.recipe).toBeUndefined();
    expect(res.error.code).toBe(RECIPE_CODES.NO_FETCH);
  });

  it('fetch throwing → fetch-failed error', async () => {
    const fetch = async () => { throw new Error('network down'); };
    const res = await loadRecipe('https://example.org/recipe.json', { fetch });
    expect(res.error.code).toBe(RECIPE_CODES.FETCH_FAILED);
  });

  it('non-JSON string → parse-failed error', async () => {
    const res = await loadRecipe('this is not json {');
    expect(res.error.code).toBe(RECIPE_CODES.PARSE_FAILED);
  });
});

describe('loadRecipe — trust seam', () => {
  it('verify returns true → loads without unverified warning', async () => {
    const res = await loadRecipe(goodRecipe(), { verify: () => true });
    expect(res.error).toBeUndefined();
    expect(res.warnings).not.toContain('unverified');
  });

  it('verify returns false → denied (deny-by-default)', async () => {
    const res = await loadRecipe(goodRecipe(), { verify: () => false });
    expect(res.recipe).toBeUndefined();
    expect(res.error.code).toBe(RECIPE_CODES.VERIFY_DENIED);
  });

  it('verify receives the normalised recipe + the raw source', async () => {
    const raw = goodRecipe();
    let seen;
    await loadRecipe(raw, { verify: (recipe, rawSource) => { seen = { recipe, rawSource }; return true; } });
    expect(seen.rawSource).toBe(raw);
    expect(seen.recipe.capabilities.task.atoms).toContain('add');
  });

  it('verify throwing → verify-error (treated as denial)', async () => {
    const res = await loadRecipe(goodRecipe(), { verify: () => { throw new Error('bad sig'); } });
    expect(res.error.code).toBe(RECIPE_CODES.VERIFY_ERROR);
  });
});

describe('loadRecipe / validateRecipe — malformed → coded issues', () => {
  it('capability noun not in the registry → bad-noun', async () => {
    const bad = goodRecipe();
    bad.capabilities = { frobnicate: { atoms: ['add'] } };
    const res = await loadRecipe(bad);
    expect(res.error.code).toBe(RECIPE_CODES.INVALID);
    expect(res.error.issues.some((i) => i.code === ISSUE_CODES.BAD_NOUN)).toBe(true);
  });

  it('capability verb not an SDK atom → bad-atom', async () => {
    const bad = goodRecipe();
    bad.capabilities = { task: { atoms: ['add', 'yeet'] } };
    const res = await loadRecipe(bad);
    expect(res.error.issues.some((i) => i.code === ISSUE_CODES.BAD_ATOM)).toBe(true);
  });

  it('freedom key not "<app> <atom> <noun>" → bad-freedom-key', async () => {
    const bad = goodRecipe();
    bad.freedoms = { 'malformed-key': {} };
    const res = await loadRecipe(bad);
    expect(res.error.issues.some((i) => i.code === ISSUE_CODES.BAD_FREEDOM_KEY)).toBe(true);
  });

  it('freedom entry with out-of-enum freedom → bad-freedom', async () => {
    const bad = goodRecipe();
    bad.freedoms = { 'stoop add task': { freedom: 'mandatory' } };
    const res = await loadRecipe(bad);
    expect(res.error.issues.some((i) => i.code === ISSUE_CODES.BAD_FREEDOM)).toBe(true);
  });

  it('freedom key with a non-registry noun → bad-noun', async () => {
    const bad = goodRecipe();
    bad.freedoms = { 'stoop add frobnicate': {} };
    const res = await loadRecipe(bad);
    expect(res.error.issues.some((i) => i.code === ISSUE_CODES.BAD_NOUN)).toBe(true);
  });

  it('setting key without "<app>.<key>" shape → bad-setting-key', async () => {
    const bad = goodRecipe();
    bad.settings = { justakey: 1 };
    const res = await loadRecipe(bad);
    expect(res.error.issues.some((i) => i.code === ISSUE_CODES.BAD_SETTING_KEY)).toBe(true);
  });

  it('non-boolean feature flag → bad-feature', async () => {
    const bad = goodRecipe();
    bad.surfaces = { features: { chat: 'yes' } };
    const res = await loadRecipe(bad);
    expect(res.error.issues.some((i) => i.code === ISSUE_CODES.BAD_FEATURE)).toBe(true);
  });

  it('non-object source → not-an-object', async () => {
    const res = await loadRecipe(42);
    expect(res.error.code).toBe(RECIPE_CODES.NOT_OBJECT);
  });
});

describe('validateRecipe — normalisation + warnings', () => {
  it('canonicalises an atom alias and warns', () => {
    // 'done' is an alias of the 'complete' atom in the SDK atom catalogue.
    const res = validateRecipe({ capabilities: { task: { atoms: ['done'] } } });
    expect(res.ok).toBe(true);
    expect(res.recipe.capabilities.task.atoms).toEqual(['complete']);
    expect(res.warnings.some((w) => w.code === 'alias-atom')).toBe(true);
  });

  it('tolerates an unknown top-level field with a warning (forward-additive)', () => {
    const res = validateRecipe({ capabilities: {}, extnaField: 123 });
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.code === 'unknown-field')).toBe(true);
  });

  it('empty recipe is valid and normalises to four empty sections', () => {
    const res = validateRecipe({});
    expect(res.ok).toBe(true);
    expect(res.recipe).toEqual({ capabilities: {}, settings: {}, surfaces: {}, freedoms: {} });
  });
});
