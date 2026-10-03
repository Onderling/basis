#!/usr/bin/env node
/**
 * privatemode-release-watch — does Privatemode's release notes page say anything about the models the bot uses?
 *
 * Privatemode deprecated kimi-k2.6 in v1.56.0 and removed it in v1.58.0; we heard of it when the bot stopped answering.
 * This reads the page, finds the lines that name one of OUR models (the default and the fallback, read from the code)
 * beside "deprecat", "remov" or "retire", and prints them — a scheduled workflow opens an issue when there are any.
 *
 *   node scripts/privatemode-release-watch.mjs            # prints the lines; exit 0 (none) or 3 (some)
 */
import { readFileSync } from 'node:fs';

export const RELEASE_NOTES_URL = 'https://docs.privatemode.ai/release/';
const root = new URL('../', import.meta.url);

/** The models the bot uses, read from the code (a fitness test keeps these readers finding them). */
export function ourModels() {
  const provider = readFileSync(new URL('packages/llm-client/src/providers/privatemode.js', root), 'utf8');
  const llm = readFileSync(new URL('apps/basis/src/telegram/assistantLlm.js', root), 'utf8');
  const def = /export const PRIVATEMODE_DEFAULT_MODEL = '([^']+)'/.exec(provider)?.[1] ?? null;
  const fallback = /key: 'assistant\.fallbackModel'[^\n]*default: '([^']+)'/.exec(llm)?.[1] ?? null;
  return [def, fallback].filter(Boolean);
}

/** A model id as release notes write it: "glm-5.3-flash" ↔ "GLM-5.3-Flash", "kimi-k2.6" ↔ "Kimi K2.6". */
const norm = (s) => String(s).toLowerCase().replace(/[\s_]+/g, '-');

/** The lines of the page's text that name one of these models beside a deprecation or a removal. */
export function linesAbout(text, models) {
  const out = [];
  for (const line of String(text).split(/\n|(?<=\.)\s+/)) {
    const l = line.trim();
    if (!l || !/deprecat|remov|retire/i.test(l)) continue;
    // a model named only as where to go ("migrate to GLM-5.3", "it routes to GLM-5.3") is the successor, not the news
    const n = norm(l.replace(/\b(?:migrate|moves?|switch|routes?|use)\s+(?:to\s+)?[\w.\- ]+/gi, ' '));
    if (models.some((m) => n.includes(norm(m)))) out.push(l.slice(0, 300));
  }
  return [...new Set(out)];
}

const htmlToText = (html) => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<\/(p|li|h\d|div|br)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');

if (import.meta.url === `file://${process.argv[1]}`) {
  const models = ourModels();
  const res = await fetch(RELEASE_NOTES_URL);
  if (!res.ok) { console.error(`privatemode-release-watch: ${RELEASE_NOTES_URL} answered ${res.status}`); process.exit(2); }
  const hits = linesAbout(htmlToText(await res.text()), models);
  console.log(`models: ${models.join(', ')}`);
  for (const h of hits) console.log(`- ${h}`);
  process.exit(hits.length ? 3 : 0);
}
