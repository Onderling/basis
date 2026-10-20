#!/usr/bin/env node
/**
 * lint-unstyled-buttons — every web button wears the one button family (`.cc-btn` in web/v2/circle.css) or a
 * class of its own; none is left to the browser's default grey chip.
 *
 * The family exists (quiet · primary · danger · ghost), and in October 2026 most buttons did not use it: they were
 * created with `document.createElement('button')` and never given a class, so each one rendered as the browser
 * default — the "unstyled grey chips" Frits saw on Vandaag. Nothing failed when one more was added; this counts them.
 *
 * "Unstyled" = none of the button's classes is styled by a web stylesheet (a BEM class nobody wrote CSS for is as bare
 * as no class). Red when a file holds MORE such buttons than its baseline (`scripts/unstyled-buttons.baseline.json`). The
 * baseline only shrinks: a file that gets better is held to its new count (`--update` writes it, and refuses to
 * write a larger number). The scan is per variable: the class a `className =` or `classList.add` sets within the lines after the
 * create. A rule scoped by an ancestor (`.screen-shell button`) is not seen — such a button stays in the count.
 *
 *   node scripts/lint-unstyled-buttons.mjs            # check
 *   node scripts/lint-unstyled-buttons.mjs --update   # shrink the baseline to the current counts
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = /^apps\/basis\/web\/.*\.js$/;
const BASELINE = 'scripts/unstyled-buttons.baseline.json';
/** How far after the create the class may be set (a button's set-up is a few lines). */
const WINDOW = 25;

/** A class selector some web stylesheet styles. */
export function styledBy(css) {
  return (cls) => new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css);
}

/**
 * The unstyled buttons in one file's source: [{ line, name, classLine }] — a button whose classes include none a
 * stylesheet styles (or that gets no class at all). `classLine` is the line that sets its class, when there is one.
 * Exported for the self-test and the sweep.
 */
export function scanSource(src, isStyled) {
  const lines = src.split('\n');
  const hits = [];
  lines.forEach((text, i) => {
    const m = text.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*['"]button['"]\s*\)/);
    if (!m) return;
    const v = m[1].replace(/\$/g, '\\$');
    let classLine = null; let classes = [];
    for (let j = i; j <= Math.min(lines.length - 1, i + WINDOW); j++) {
      const cm = lines[j].match(new RegExp(`\\b${v}\\.className\\s*=\\s*[\`'"]([^\`'"]*)`));
      if (cm) { classLine = j + 1; classes = cm[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean); break; }
      const cl = lines[j].match(new RegExp(`\\b${v}\\.classList\\.add\\(([^)]*)\\)`));
      if (cl) { classes = (cl[1].match(/['"]([^'"]+)['"]/g) ?? []).map((x) => x.slice(1, -1)); break; }
    }
    if (!classes.some(isStyled)) hits.push({ line: i + 1, name: m[1], classLine });
  });
  return hits;
}

function webCss(root) {
  return execSync('git ls-files apps/basis/web', { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.css'))
    .map((f) => { try { return readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } }).join('\n');
}

function counts(root) {
  const isStyled = styledBy(webCss(root));
  const files = execSync('git ls-files', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((f) => SCOPE.test(f));
  const out = {};
  for (const f of files) {
    let src; try { src = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const n = scanSource(src, isStyled).length;
    if (n) out[f] = n;
  }
  return out;
}

function main() {
  const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const now = counts(root);
  const basePath = path.join(root, BASELINE);
  const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : {};
  if (process.argv.includes('--update')) {
    const grown = Object.entries(now).filter(([f, n]) => n > (base[f] ?? 0));
    if (grown.length && Object.keys(base).length) {
      console.error(`✗ lint:unstyled-buttons --update refuses to grow the baseline:\n${grown.map(([f, n]) => `   - ${f}: ${base[f] ?? 0} → ${n}`).join('\n')}`);
      process.exit(1);
    }
    writeFileSync(basePath, JSON.stringify(Object.fromEntries(Object.entries(now).sort()), null, 2) + '\n');
    console.log(`✓ lint:unstyled-buttons: baseline written (${Object.values(now).reduce((a, b) => a + b, 0)} unstyled buttons).`);
    return;
  }
  const over = Object.entries(now).filter(([f, n]) => n > (base[f] ?? 0));
  if (over.length) {
    console.error(`\n✗ lint:unstyled-buttons — a web button no stylesheet styles (the browser's default chip):\n`);
    for (const [f, n] of over) {
      console.error(`   - ${f}: ${n} unstyled (baseline ${base[f] ?? 0})`);
      let src = ''; try { src = readFileSync(path.join(root, f), 'utf8'); } catch { /* */ }
      for (const h of scanSource(src, styledBy(webCss(root)))) console.error(`       ${f}:${h.line}  ${h.name}`);
    }
    console.error(`
Give it the family: \`b.className = 'cc-btn cc-btn--quiet'\` (one \`--primary\` per screen, \`--danger\` where it
destroys), or a class of its own that circle.css styles.
`);
    process.exit(1);
  }
  const shrunk = Object.entries(base).filter(([f, n]) => (now[f] ?? 0) < n);
  const total = Object.values(now).reduce((a, b) => a + b, 0);
  console.log(`✓ lint:unstyled-buttons: ${total} unstyled web buttons, none above the baseline${shrunk.length ? ` (${shrunk.length} file(s) below it — run --update to hold them there)` : ''}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
