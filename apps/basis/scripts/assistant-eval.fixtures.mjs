/**
 * The assistant's golden set — utterances with what we accept as right. Lifted from the 2026-09-05
 * walks where marked. `expect`: `{ op, args?, count? }` (args match case-insensitively; a RegExp
 * matches), `{ reply: 'asks' | 'declines' }`, or null (must do nothing). `before`: memory lines.
 * `items`: what retrieval may see.
 */
export const FIXTURES = [
  // ── the deterministic gate (no model should be needed; via=rule) ──
  { id: 'gate-add-typed-nl',  text: 'zet kaas op het boodschappenlijstje', expect: { op: 'addItem', args: { type: 'shopping', text: 'kaas' } } },
  { id: 'gate-list-nl',       text: 'wat staat er op de boodschappenlijst?', expect: { op: 'listOpen', args: { type: 'shopping' } } },
  { id: 'gate-add-typed-en',  text: 'add bread to the shopping list', lang: 'en', expect: { op: 'addItem', args: { type: 'shopping', text: 'bread' } } },
  // ── the model: single adds (walk 1 + 2) ──
  { id: 'add-plain-nl',       text: 'Anyway, zet zout maar op de boodschappenlijst', expect: { op: 'addItem', args: { type: 'shopping', text: /zout/ } } },
  { id: 'add-erbij-nl',       text: 'Doe broccoli erbij', before: ['you: wat staat er op de boodschappenlijst', 'system: 1. stokbrood 2. brood'], expect: { op: 'addItem', args: { type: 'shopping', text: /broccoli/ } } },
  { id: 'add-kunje-nl',       text: 'Kun je brood en eieren toevoegen?', before: ['you: wat staat er nu op de lijst', 'system: 1. stokbrood 2. broccoli 3. zout'], expect: { op: 'addItem', args: { type: 'shopping', text: /brood/ } } },   // walk 2: picked listOpen
  { id: 'add-want-nl',        text: 'Ehm ja, ik wil graag braadlappen kopen', before: ['you: ik wil vandaag stokbrood halen', 'system: ✓ added to shopping: stokbrood'], expect: { op: 'addItem', args: { type: 'shopping', text: /braadlappen/ } } },   // walk 1: fabricated ✓
  { id: 'add-followup-nl',    text: 'En geurkazen', before: ['you: ik wil graag braadlappen kopen', 'system: ✓ added to shopping: braadlappen'], expect: { op: 'addItem', args: { type: 'shopping', text: /^geurkazen$/i } } },   // walk 1: "En geurkazen" as text
  // ── multi-item (walk 1: only the first landed) ──
  { id: 'add-multi-nl',       text: 'Hoi, ik wil vandaag het volgende halen bij de winkel: stokbrood, braadlappen en geurkazen', expect: { op: 'addItem', args: { type: 'shopping' }, count: 3 } },
  { id: 'add-two-nl',         text: 'zet brood en eieren op de boodschappen', expect: { op: 'addItem', args: { type: 'shopping' } } },
  // ── complete / remove ──
  { id: 'done-bought-nl',     text: 'Kaas is gekocht', items: ['kaas', 'melk'], expect: { op: 'markComplete', args: { match: /kaas/ } } },
  // ── memory: a bare answer to the bot's question ──
  { id: 'memory-which-list',  text: 'De boodschappenlijst', before: ['you: wat staat er op de lijst', 'assistant: Welke lijst bedoel je — boodschappen of klusjes?'], expect: { op: 'listOpen', args: { type: 'shopping' } } },
  { id: 'memory-show-first',  text: 'Laat eerst maar zien', before: ['you: ik wil boodschappen doen!', 'assistant: prima, wil je de boodschappenlijst zien, of iets toevoegen?'], expect: { op: 'listOpen', args: { type: 'shopping' } } },
  // ── ambiguity: the model should ASK, not guess ──
  { id: 'ask-which-list',     text: 'Wat staat er op de lijst', expect: { reply: 'asks' } },
  // ── not our business: a spoken decline in the member's language, never a tool ──
  { id: 'decline-time-nl',    text: 'Hoe laat is het', expect: { reply: 'declines' } },
  { id: 'decline-socks-nl',   text: 'Kun je ook sokken stoppen', expect: { reply: 'declines' } },
  { id: 'greeting-nl',        text: 'Maii', expect: { reply: 'declines' } },   // walk 2: answered in English
];
