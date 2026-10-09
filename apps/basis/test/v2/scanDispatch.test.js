/**
 * Me → Scan / `/scan-qr`: the route table names DECLARED targets (`SCAN_TARGETS`); each shell's per-id painter map
 * (`SCAN_PAINTERS`) — the one shell-side piece, composition — must name every one of them, so a new declared target
 * cannot be scanned into silence. Pairing is HELD on purpose in PR 1 (a picker-capable form on both shells is its own
 * row): both maps say so with `null`, which the shells turn into a sentence, never a dropped code.
 * Source text: the RN screen cannot render under vitest, and both maps are module-local by design.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCAN_TARGETS } from '../../src/v2/scanRoute.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SHELLS = {
  web: read('../../web/v2/circleApp.js'),
  mobile: read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js'),
};
const mapOfAny = (src) => {
  const at = src.indexOf('const SCAN_PAINTERS = {');
  const end = src.indexOf('\n};\n', at) > -1 && src.indexOf('\n};\n', at) < (src.indexOf('\n  };\n', at) > -1 ? src.indexOf('\n  };\n', at) : Infinity)
    ? src.indexOf('\n};\n', at) : src.indexOf('\n  };\n', at);
  return at > -1 ? src.slice(at, end) : '';
};

describe('every declared scan target has a painter in each shell', () => {
  for (const [shell, src] of Object.entries(SHELLS)) {
    const map = mapOfAny(src);
    it(`${shell}: SCAN_PAINTERS names every declared target`, () => {
      expect(map, `${shell} has no SCAN_PAINTERS`).not.toBe('');
      for (const t of Object.values(SCAN_TARGETS)) {
        const key = /^[A-Za-z_$][\w$]*$/.test(t.id) ? `${t.id}:` : `'${t.id}':`;
        expect(map, `${shell}: no painter entry for ${t.id}`).toContain(key);
      }
    });
    it(`${shell}: pairing is held ON PURPOSE (null), and the shell says so`, () => {
      expect(map).toMatch(/pairCirclePeer:\s*null,/);
      expect(src).toMatch(/circle\.scan\.pair_held/);
    });
  }
  it('mobile: ONE scanner mount, in the overlay painted beside every view', () => {
    const m = SHELLS.mobile;
    expect((m.match(/<QrScannerModal /g) ?? []).length).toBe(1);
    expect(m).toMatch(/const scanOverlays = \(\n\s*<>\n\s*<QrScannerModal visible=\{joinScanOpen\}[^\n]*onResult=\{onScan\}/);
    expect(m).toMatch(/\{page\}\n\s*\{scanOverlays\}/);
  });
  it("the scanner itself speaks the shared words: one 'unknown' key and one paste placeholder on both shells", () => {
    const scanner = read('../../../basis-mobile/src/rn/QrScannerModal.js');
    expect(scanner).toMatch(/t\('scan_qr\.scan_unknown'\)/);
    expect(scanner).toMatch(/t\('circle\.scan\.paste_placeholder'\)/);
    expect(scanner).not.toMatch(/chat\.scan_unknown/);
    expect(SHELLS.web).toMatch(/t\('scan_qr\.scan_unknown'\)/);
  });
  it("web: scanQr's seam is the paste prompt, through the route table", () => {
    expect(SHELLS.web).toMatch(/openQrScanner: \(\) => \{[^\n]*takeScannedText\(v\)/);
    expect(SHELLS.web).toMatch(/const r = routeScan\(text\);/);
  });
});
