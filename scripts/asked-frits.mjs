#!/usr/bin/env node
/**
 * asked-frits — the "what is Frits still being asked?" table, GENERATED from the ledger's own marker.
 *
 * A question raised mid-work and not answered is a silence, not a decision (CLAUDE.md: an idea is only
 * dropped when Frits drops it). So the open questions need to be visible in one place — but a hand-kept list
 * beside the `? Needs Frits` markers is two places for one fact, and in this repo a maintained list drifts.
 * It drifted within a day of being written: the markers said 55, the table said 4.
 *
 * So the table is a projection. The MARKER is the fact; this rewrites the block between the two comments to
 * match it. Answering a question means editing the row where the answer belongs — replacing `? Needs Frits`
 * with `✅ answered <date>` — and the table follows. Nothing is ever cleared here.
 *
 * PRIVACY: this file is tracked/public and `REMAINING-WORK.md` is not. It reads that file by a path passed in
 * or defaulted, and prints nothing from it on `--check` beyond a count — the same rule `lint-ledger.mjs`
 * follows for the same reason.
 *
 *   node scripts/asked-frits.mjs            rewrite the block in place
 *   node scripts/asked-frits.mjs --check    exit 1 if the block is stale (the guard)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// The roadmap is gitignored, so a test must be able to point this at a throwaway copy rather than the real
// one — a generator whose only test target is the live file is a test nobody dares run.
const FILE = process.env.ASKED_FRITS_FILE || path.join(ROOT, 'REMAINING-WORK.md');
const BEGIN = '<!-- asked-frits:begin -->';
const END = '<!-- asked-frits:end -->';

const MARKER = /\?\s*Needs Frits/;
/** `[ledger L12]` / `[ledger n/a — a product call]` — the tag the ledger guard already requires. */
const TAG = /\[ledger\s+(L\d+|n\/a)[^\]]*\]/i;
/** A date the row states for itself. Not invented when absent: a wrong date is worse than none. */
const DATE = /\b(20\d\d-\d\d-\d\d)\b/;

/**
 * One table row per marker line. Line numbers are the point: the question stays where its context is.
 *
 * THE BLOCK IS NOT SCANNED. A generated table that reads itself is not a projection, it is a feedback loop —
 * the first run rendered its own rows as new markers and the second run disagreed with the first.
 */
/** A line that starts a new unit: a list item, a heading, a table row, a quote bullet. */
const ITEM_START = /^\s*(?:>\s*)?(?:\d+\.\s|[-*]\s|#|\|)/;
// Underscores stay: they are half of every identifier the ledger names (`DEFAULT_CIRCLE_ORIGINS`).
const clean = (s) => s.replace(/[*`>|]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The marker's whole ITEM, wrapped lines joined: up to the line that starts it, down to the blank line or the
 * next item. A table row is its own item. The ledger is hard-wrapped at ~120 columns, so reading only the
 * marker's line cut most questions in half.
 */
function itemAround(all, i) {
  if (/^\s*\|/.test(all[i])) return all[i];
  // A blockquote is read as its content: its `> ` prefixes would otherwise hide every sentence break.
  const lines = all.map((l) => l.replace(/^\s*>\s?/, ''));
  let a = i;
  while (a > 0 && !ITEM_START.test(lines[a]) && lines[a - 1].trim() !== '') a -= 1;
  let b = i;
  while (b + 1 < lines.length && lines[b + 1].trim() !== '' && !ITEM_START.test(lines[b + 1])) b += 1;
  return lines.slice(a, b + 1).join(' ');
}

/**
 * The question, in order of preference:
 *   1. the sentence that carries the marker — the question is written before it as often as after it;
 *   2. when that sentence is only the marker (it sits in the closing `[ledger Lnn — ? Needs Frits: when]`),
 *      the item's bold title, which is how a ledger row names its question;
 * plus the ASK — the short "(rank it)" / ": when" right after the marker — which says what kind of answer
 * is wanted.
 */
function questionOf(raw) {
  // The marker opens with a "?", which the sentence split below would take for the end of a sentence.
  const item = raw.replace(MARKER, '\u0000NF');
  const at = item.indexOf('\u0000NF');
  const after = item.slice(at + 3);
  const ask = (after.match(/^\s*(?:\(([^)]{1,60})\)|:\s*([^.\]\n*]{1,40}?)\s*(?:\]|\.|\*\*|$))/) || [])
    .slice(1).find(Boolean)?.trim();
  // Sentences end at . ? ! followed by a capital, a bracket or markdown — not at a file name's dot.
  const parts = item.split(/(?<=[.!?]\**)\s+(?=\**[A-Z(\["“'*])/);
  let pos = 0;
  let k = 0;
  for (; k < parts.length; k += 1) {
    const end = item.indexOf(parts[k], pos) + parts[k].length;
    if (end > at) break;
    pos = end;
  }
  const tidy = (s) => clean((s || '').replace(TAG, '').replace(/\[[^\]]*\u0000NF[^\]]*\]/, '')
    .replace(/\[ledger[^\]]*\]/i, '').replace('\u0000NF', '').replace(/^\s*\d+\.\s*/, '').replace(/\[L\d+\]/, ''))
    .replace(/\s+\./g, '.').replace(/\.{2,}/g, '.').replace(/([?!])\.+/g, '$1')
    .replace(/^[—–\-:,.\s]+/, '').replace(/[—–\-:,\s]+$/, '');
  let q = tidy(parts[k]);
  if (q.length < 25) {
    // The marker stands alone at the end of the item: the item's title names the question, or, with no
    // title, the sentence just before the marker does.
    const title = item.match(/\*\*\s*\[L\d+\]\s*([\s\S]*?)\*\*/)?.[1];
    const before = k > 0 ? tidy(parts[k - 1]) : '';
    if (title) q = tidy(title);
    else if (before) q = `${before}${q ? ` ${q}` : ''}`;
  }
  if (ask && !q.toLowerCase().includes(ask.toLowerCase())) q = `${q} — *${ask}*`;
  return q;
}

function rows(text) {
  const out = [];
  let inBlock = false;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.includes(BEGIN)) { inBlock = true; return; }
    if (line.includes(END)) { inBlock = false; return; }
    if (inBlock) return;
    if (!MARKER.test(line)) return;
    // Three things carry the marker without being a live question, and all three are kept ON PURPOSE:
    //   · the ledger's own heading, which names the section;
    //   · a line TALKING about the practice — a brief quoting it, a lesson written up with it in quotes;
    //   · text after a `Was:`, which is how an ANSWERED row keeps its original wording for context. That one
    //     matters most: the row above it says what was decided, so counting it again reports a settled
    //     question as open, which is the same drift in the other direction.
    if (/^#+\s/.test(line.trim())) return;
    if (line.includes('asked-frits') || line.includes('`? Needs Frits`') || line.includes('"? Needs Frits')) return;
    const was = line.search(/\bWas:/);
    if (was >= 0 && line.search(MARKER) > was) return;
    const tag = ((line.match(TAG) ?? line.match(/ledger\s+(L\d+)/i))?.[1] ?? 'n/a').replace(/^l/, 'L');
    const date = line.match(DATE)?.[1] ?? '—';
    const q = questionOf(itemAround(lines, i));
    const cut = q.length > 160 ? `${q.slice(0, q.lastIndexOf(' ', 160))}…` : q;
    out.push({ n: i + 1, tag, date, q: cut || '(see the row)' });
  });
  return out.reverse();   // newest first — the ledger grows downward, so the last marker is the newest
}

function render(list) {
  const head = [
    '| line | ledger | raised | the question |',
    '|---|---|---|---|',
  ];
  const body = list.map((r) => `| ${r.n} | ${r.tag} | ${r.date} | ${r.q} |`);
  return [
    BEGIN,
    `*Generated by \`node scripts/asked-frits.mjs\` from every \`? Needs Frits\` marker below — **${list.length} open**.`,
    'Do not edit this block. To ANSWER one, edit the row it lives on (replace the marker with `✅ answered <date>`),',
    'so the answer sits with its context; the table follows. Never clear a question because the work moved on.*',
    '',
    ...head,
    ...body,
    END,
  ].join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(FILE)) {
    // The private roadmap is gitignored; a clone without it must not fail the aggregate.
    if (!check) console.log('asked-frits: no REMAINING-WORK.md here — nothing to project.');
    process.exit(0);
  }
  const text = readFileSync(FILE, 'utf8');
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b < 0 || e < 0 || e < b) {
    console.error(`\n✖ asked-frits: the ${BEGIN} / ${END} block is missing from the roadmap.`);
    console.error('  Add the two comment lines where the table belongs, then run this script.\n');
    process.exit(1);
  }
  const wanted = render(rows(text));
  const current = text.slice(b, e + END.length);
  if (current === wanted) {
    if (!check) console.log(`asked-frits: up to date (${rows(text).length} open).`);
    process.exit(0);
  }
  if (check) {
    console.error('\n✖ asked-frits: the open-questions table does not match the `? Needs Frits` markers.');
    console.error('  Run `node scripts/asked-frits.mjs` and commit. The table is generated, never hand-edited —');
    console.error('  a list maintained beside the markers drifts, which is why it is a projection.\n');
    process.exit(1);
  }
  // A FIXED POINT, not one pass. The table states LINE NUMBERS, and rewriting the block moves every line
  // below it — so a single rewrite invalidates the numbers it just wrote, and `--check` would fail on a file
  // that had only just been generated. Rewriting until the content stops changing settles that in two rounds
  // (the block's height converges as soon as the row count does); the cap is only there so a pathological
  // oscillation cannot spin.
  let out = text;
  for (let round = 0; round < 8; round += 1) {
    const bb = out.indexOf(BEGIN);
    const ee = out.indexOf(END);
    const next = out.slice(0, bb) + render(rows(out)) + out.slice(ee + END.length);
    if (next === out) break;
    out = next;
  }
  writeFileSync(FILE, out);
  console.log(`asked-frits: rewrote the table (${rows(out).length} open).`);
}

main();
