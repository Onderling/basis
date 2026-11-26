/**
 * Self-test for lint-store-reads: it sees a stored value parsed by hand — on raw storage AND on a sealed store, which
 * still offers getItem — and a persist adapter without the gate; it does not see a read through getJson.
 */
import { describe, it, expect } from 'vitest';
import { findingsIn, check } from './lint-store-reads.mjs';

describe('lint-store-reads', () => {
  it('sees getItem + JSON.parse on raw storage', () => {
    expect(findingsIn("const raw = await AsyncStorage.getItem(K);\nconst v = raw ? JSON.parse(raw) : {};").handParsed).toBe(1);
  });
  it('sees it on a sealed store too (sealedKeyValue still offers getItem)', () => {
    expect(findingsIn("const kv = sealedKeyValue(s, {});\nconst t = await kv.getItem(K);\n\nreturn t ? JSON.parse(t) : null;").handParsed).toBe(1);
  });
  it('sees a FILE store parsing by hand (readFile / readFileSync + JSON.parse)', () => {
    expect(findingsIn("const raw = await readFile(p, 'utf8');\nreturn JSON.parse(raw);").handParsed).toBe(1);
    expect(findingsIn("try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }").handParsed).toBe(1);
  });
  it('sees the one-line form', () => {
    expect(findingsIn("load: () => { try { return JSON.parse(storage?.getItem(KEY) ?? '{}'); } catch { return {}; } },").handParsed).toBe(1);
  });
  it('does not see a read through getJson, or a parse far from any getItem', () => {
    expect(findingsIn("const v = await kv.getJson(K);\nconst w = JSON.parse(body);").handParsed).toBe(0);
    expect(findingsIn("const a = await s.getItem(K);\n1;\n2;\n3;\n4;\nJSON.parse(other);").handParsed).toBe(0);
  });
  it('ignores a comment that names both', () => {
    expect(findingsIn("// getItem + JSON.parse by hand is what this replaced\nconst v = await kv.getJson(K);").handParsed).toBe(0);
  });
  it('sees a persist adapter that skips the gate, and not one that uses it', () => {
    expect(findingsIn('class FilePersist { async load() {} }').gatelessPersist).toEqual(['FilePersist']);
    expect(findingsIn("import { mapSnapshotGate } from 'x';\nclass FilePersist { async load() {} }").gatelessPersist).toEqual([]);
  });
  it('says on which lines a value is parsed by hand, and where a gateless persist adapter is declared', () => {
    const f = findingsIn("const a = 1;\nconst raw = await AsyncStorage.getItem(K);\nconst v = raw ? JSON.parse(raw) : {};\nclass FilePersist {}");
    expect(f.handParsedLines).toEqual([3]);
    expect(f.persistLines).toEqual({ FilePersist: 4 });
  });
  it('the repo itself is clean against its baseline', () => {
    expect(check()).toEqual([]);
  });
});
