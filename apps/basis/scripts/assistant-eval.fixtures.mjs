/**
 * The assistant's golden set — utterances with what we accept as right. Lifted from the 2026-09-05
 * walks where marked. `expect`: `{ op, args?, count? }` (args match case-insensitively; a RegExp
 * matches), `{ reply: 'asks' | 'declines' }`, or null (must do nothing). `before`: memory lines.
 * `items`: what retrieval may see (and what a read shows, with ids `i0`, `i1`, …). `exact`: exactly `count` calls (1 by default). `lines` (instead of `text`): lines sent at once, which the collect window makes one
 * turn — one model call.
 */
export const FIXTURES = [
  // ── the deterministic gate (no model should be needed; via=rule) ──
  { id: 'gate-add-typed-nl',  text: 'zet kaas op het boodschappenlijstje', expect: { op: 'addToList', args: { list: /boodschappen/, text: 'kaas' } } },
  { id: 'gate-list-nl',       text: 'wat staat er op de boodschappenlijst?', expect: { op: 'listEntries', args: { list: /boodschappen/ } } },
  { id: 'gate-add-typed-en',  text: 'add bread to the shopping list', lang: 'en', expect: { op: 'addToList', args: { list: /boodschappen/, text: 'bread' } } },
  // ── the model: single adds (walk 1 + 2) ──
  { id: 'add-plain-nl',       text: 'Anyway, zet zout maar op de boodschappenlijst', expect: { op: 'addToList', args: { list: /boodschappen/, text: /zout/ } } },
  { id: 'add-erbij-nl',       text: 'Doe broccoli erbij', before: ['you: wat staat er op de boodschappenlijst', 'system: 1. stokbrood 2. brood'], expect: { op: 'addToList', args: { list: /boodschappen/, text: /broccoli/ } } },
  { id: 'add-kunje-nl',       text: 'Kun je brood en eieren toevoegen?', before: ['you: wat staat er nu op de lijst', 'system: 1. stokbrood 2. broccoli 3. zout'], expect: { op: 'addToList', args: { list: /boodschappen/, text: /brood/ } } },   // walk 2: picked listOpen
  { id: 'add-want-nl',        text: 'Ehm ja, ik wil graag braadlappen kopen', before: ['you: ik wil vandaag stokbrood halen', 'system: ✓ added to shopping: stokbrood'], expect: { op: 'addToList', args: { list: /boodschappen/, text: /braadlappen/ } } },   // walk 1: fabricated ✓
  { id: 'add-followup-nl',    text: 'En geurkazen', before: ['you: ik wil graag braadlappen kopen', 'system: ✓ added to shopping: braadlappen'], expect: { op: 'addToList', args: { list: /boodschappen/, text: /^geurkazen$/i } } },   // walk 1: "En geurkazen" as text
  // ── multi-item (walk 1: only the first landed) ──
  { id: 'add-multi-nl',       text: 'Hoi, ik wil vandaag het volgende halen bij de winkel: stokbrood, braadlappen en geurkazen', expect: { op: 'addToList', args: { list: /boodschappen/ }, count: 3 } },
  { id: 'add-two-nl',         text: 'zet brood en eieren op de boodschappen', expect: { op: 'addToList', args: { list: /boodschappen/ } } },
  // three quick lines, one turn (the collect window): one model call, three adds
  { id: 'collect-three-lines-nl', lines: ['melk', 'brood', 'eieren'], expect: { op: 'addToList', args: { list: /boodschappen/ }, count: 3 } },
  { id: 'add-three-plain-nl', text: 'zet stokbrood, melk en eieren op de boodschappenlijst', expect: { op: 'addToList', args: { list: /boodschappen/ }, count: 3 } },
  // ── an untyped add ASKS which list (L90): the gate hands addItem without a type; the shell asks ──
  { id: 'gate-add-untyped-nl', text: 'voeg ook de braadlappen en geurkazen toe', expect: { anyOf: [{ reply: 'asks' }, { op: 'addToList', args: { text: /braadlappen/ } }] } },
  { id: 'gate-add-untyped-en', text: 'add milk to the list', lang: 'en', expect: { anyOf: [{ reply: 'asks' }, { op: 'addToList', args: { text: 'milk' } }] } },
  { id: 'gate-add-task-en',    text: 'add task call the plumber', lang: 'en', expect: { op: 'addToList', args: { list: /klusjes/ } } },
  { id: 'gate-add-colon-nl',   text: 'Voeg toe: spruiten kopen', expect: { anyOf: [{ reply: 'asks' }, { op: 'addToList', args: { text: /spruiten/ } }] } },   // walk 3: became a task "toe: spruiten kopen"
  { id: 'add-typed-colon-nl',  text: 'Kun je er opzetten: kraan aandraaien', before: ['you: wat staat er op de reparatieslijst', 'system: Nog niets.'], expect: { op: 'addToList', args: { list: /reparaties/, text: /kraan/ } } },
  { id: 'add-three-repair-nl', text: 'Ook graag op reparaties: wasmachine reinigen, vloer ontkleven en kopjes afbreien', expect: { op: 'addToList', args: { list: /reparaties/ }, count: 3 } },
  { id: 'list-tasks-nl',       text: 'Wat staat er op de takenlijst', expect: { anyOf: [{ op: 'listMine' }, { op: 'listEntries', args: { list: /klusjes/ } }] } },
  { id: 'list-now-vague-nl',   text: 'Wat staat op de lijst nu?', expect: { anyOf: [{ reply: 'asks' }, { op: 'listLists' }, { op: 'listEntries' }] } },
  // ── complete / remove ──
  { id: 'done-bought-nl',     text: 'Kaas is gekocht', items: ['kaas', 'melk'], expect: { anyOf: [{ reply: 'asks' }, { op: 'markListItemDone' }, { op: 'removeFromList', args: { item: /kaas/ } }] } },
  // ── the newest message only (walk 2026-09-29: an unanswered earlier request was redone beside the new one) ──
  { id: 'newest-only-nl',     text: 'Doe er ook melk bij',   // past the gate, so the model decides before: ['you: maak een nieuwe lijst: cadeaus', 'system: Geen lijst "cadeaus" hier.'], expect: { op: 'addToList', args: { text: /^melk$/ }, count: 1, exact: true } },
  // ── a member asks for the admin's tool: told so, not squeezed into another op (walk 2026-09-29) ──
  { id: 'member-admin-op-nl', text: 'maak een nieuwe lijst: cadeaus', expect: { reply: 'declines' } },
  // ── memory: a bare answer to the bot's question ──
  { id: 'memory-which-list',  text: 'De boodschappenlijst', before: ['you: wat staat er op de lijst', 'assistant: Welke lijst bedoel je — boodschappen of klusjes?'], expect: { op: 'listEntries', args: { list: /boodschappen/ } } },
  { id: 'memory-show-first',  text: 'Laat eerst maar zien', before: ['you: ik wil boodschappen doen!', 'assistant: prima, wil je de boodschappenlijst zien, of iets toevoegen?'], expect: { op: 'listEntries', args: { list: /boodschappen/ } } },
  // ── ambiguity: the model should ASK, not guess ──
  { id: 'ask-which-list',     text: 'Wat staat er op de lijst', expect: { anyOf: [{ reply: 'asks' }, { op: 'listLists' }, { op: 'listEntries' }] } },   // asking, or showing what lists there are, both fine
  // ── not our business: a spoken decline in the member's language, never a tool ──
  { id: 'decline-time-nl',    text: 'Hoe laat is het', expect: { reply: 'declines' } },
  { id: 'decline-socks-nl',   text: 'Kun je ook sokken stoppen', expect: { reply: 'declines' } },
  // the member's language: an English line gets an English answer, also on a Dutch door (--door-lang nl)
  { id: 'greet-en',           text: 'good morning, how are you', lang: 'en', expect: { reply: 'declines', in: 'en' } },
  { id: 'decline-time-en',    text: 'what time is it now', lang: 'en', expect: { reply: 'declines', in: 'en' } },
  { id: 'decline-socks-en',   text: 'can you also darn my socks', lang: 'en', expect: { reply: 'declines', in: 'en' } },
  { id: 'greet-nl',           text: 'goedemorgen', expect: { reply: 'declines' } },   // a greeting gets a spoken greeting, never silence
  { id: 'greeting-nl',        text: 'Maii', expect: { reply: 'declines' } },   // walk 2: answered in English
];
