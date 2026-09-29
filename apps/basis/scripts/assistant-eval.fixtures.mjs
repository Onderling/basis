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
  { id: 'newest-only-nl',     text: 'Wat staat er op de takenlijst?', before: ['you: maak een nieuwe lijst: cadeaus', 'system: Geen lijst "cadeaus" hier.'], expect: { anyOf: [{ op: 'listMine', count: 1, exact: true }, { op: 'listEntries', args: { list: /klusjes/ }, count: 1, exact: true }] } },   // a newest message that cannot refer back
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
  // ── Fable's probe set (2026-09-30): the cases the set above does not cover — splits, chores and appointments by
  //    their words, two tools in one message, back-references, the admin's op asked by a member ──
  { id: 'p-split-en',        text: 'kaas en eieren', expect: { op: 'addToList', args: { list: /boodschappen/ }, count: 2 } },
  { id: 'p-split-comma',     text: 'zet melk, boter en jam op de lijst', expect: { op: 'addToList', args: { list: /boodschappen/ }, count: 3 } },
  { id: 'p-pair-unit',       text: 'peper en zout op de boodschappen', expect: { anyOf: [{ op: 'addToList', args: { list: /boodschappen/ }, count: 2 }, { op: 'addToList', args: { list: /boodschappen/, text: /peper en zout/ } }] } },
  { id: 'p-implicit-add',    text: 'we hebben geen brood meer', expect: { anyOf: [{ op: 'addToList', args: { text: /brood/ } }, { reply: 'asks' }] } },
  { id: 'p-claim-words',     text: 'ik doe de lamp', items: ['lamp vervangen (Klusjes)', 'vuilnis buiten zetten (Klusjes)'], expect: { op: 'claimTask', args: { id: /lamp|i0/ } } },
  { id: 'p-complete-words',  text: 'de lamp is gemaakt', items: ['lamp vervangen (Klusjes)'], expect: { anyOf: [{ op: 'completeTask' }, { op: 'markListItemDone' }] } },
  { id: 'p-mine',            text: 'heb ik nog klusjes?', expect: { op: 'listMine' } },
  { id: 'p-event-add',       text: 'tandarts morgen om 10 uur', expect: { op: 'addEvent', args: { title: /tandarts/, when: /T10:00/ } } },
  { id: 'p-event-relative',  text: 'volgende week dinsdag om 9 uur huisarts', expect: { op: 'addEvent', args: { title: /huisarts/, when: /T09:00/ } } },
  { id: 'p-event-list',      text: 'wat staat er deze week in de agenda?', expect: { anyOf: [{ op: 'listEvents' }, { op: 'listEntries', args: { list: /agenda/ } }] } },
  { id: 'p-rsvp-words',      text: 'ik kom naar de tandarts', items: ['2026-10-01 10:00 · tandarts (Agenda)'], expect: { op: 'rsvpAccept', args: { id: /tandarts|i0/ } } },
  { id: 'p-two-tools',       text: 'zet melk op de lijst en maak een klusje: lamp vervangen', expect: { op: 'addToList', count: 2 } },
  { id: 'p-flow-dinner',     text: 'plan een etentje zaterdag om 19 uur en zet wijn en kaas op de boodschappen', expect: { anyOf: [{ op: 'addEvent', count: 3 }, { op: 'addToList', count: 3 }] } },
  { id: 'p-chain-done-add',  text: 'ik heb de lamp gedaan, zet een nieuwe lamp op de boodschappen', items: ['lamp vervangen (Klusjes)'], expect: { anyOf: [{ op: 'completeTask', count: 2 }, { op: 'addToList', count: 2 }, { op: 'markListItemDone', count: 2 }] } },
  { id: 'p-backref',         text: 'doe er ook melk bij', before: ['you: zet brood op de boodschappen', 'system: ✓ Toegevoegd aan Boodschappen: brood'], expect: { op: 'addToList', args: { list: /boodschappen/, text: /melk/ } } },
  { id: 'p-remove',          text: 'haal melk van de boodschappenlijst', items: ['melk (Boodschappen)'], expect: { op: 'removeFromList', args: { item: /melk|i0/ } } },
  { id: 'p-edit',            text: 'verander melk in halfvolle melk', items: ['melk (Boodschappen)'], expect: { op: 'editEntry' } },
  { id: 'p-repairs-colon',   text: 'en op reparaties: de kraan lekt', expect: { op: 'addToList', args: { list: /reparaties/, text: /kraan/ } } },
  { id: 'p-admin-op-member', text: 'gooi de klusjeslijst weg', expect: { reply: 'declines' } },
  { id: 'p-thanks',          text: 'dankjewel!', expect: { reply: 'declines' } },
  { id: 'p-mixed-en',        text: 'add dentist to the agenda tomorrow at 10', lang: 'en', expect: { op: 'addEvent', args: { title: /dentist/ } } },
  { id: 'p-question-count',  text: 'hoeveel dingen staan er op de boodschappenlijst?', expect: { anyOf: [{ op: 'listEntries', args: { list: /boodschappen/ } }, { reply: 'asks' }] } },
  { id: 'p-who-does',        text: 'wie doet de lamp?', items: ['lamp vervangen (Klusjes)'], expect: { anyOf: [{ op: 'listEntries', args: { list: /klusjes/ } }, { op: 'listMine' }, { reply: 'asks' }, { reply: 'declines' }] } },
  { id: 'p-tick-partial',    text: 'kaas is gekocht', items: ['kaas en eieren (Boodschappen)', 'melk (Boodschappen)'], expect: { anyOf: [{ reply: 'asks' }, { op: 'markListItemDone' }] } },
];
