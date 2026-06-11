// Deterministic incident lexicons + helpers — the high-recall safety nets
// under the LLM triage pass (src/triage.js). Intentionally over-inclusive: a
// match ALWAYS routes the message to its track regardless of the model.
//
// ⚠ Lexicons are a FLOOR, not the guarantee. The stress test (docs/
// STRESS-TEST-RESULTS.md) showed serious reports slip past them, so the real
// safety net is: serious categories route BEFORE the k-gate, and sensitive
// below-threshold items are QUARANTINED for human review, never deleted.

// Widened after the zorg (Richting B) baseline missed 4/4 indirect suicidal
// lines. High-recall by design: false positives are acceptable (a human reviews
// the crisis track); a miss is not. Only THIS lexicon may set the "crisis"
// category (crisis-reservation rule, enforced in categories.js precedence).
const CRISIS = [
  // Dutch — direct
  /\bik wil dood\b/i,
  /\bniet meer\s+(willen\s+)?(leven|bestaan)\b/i,
  /\bwil(?:\s+\w+){0,4}\s+niet meer\s+(leven|verder|zijn|hier zijn|bestaan)\b/i,
  /\ber niet meer\s+(willen\s+)?zijn\b/i,
  /\bzelfmoord\b/i, /\bzelfdoding\b/i, /\bzelf doden\b/i,
  /\bmezelf (iets aandoen|van het leven beroven)\b/i,
  /\been eind aan (mijn|het) leven\b/i,
  /\ber een eind aan maken\b/i,
  // Dutch — indirect / planning (the zorg misses)
  /\bniet meer wil\b/i,                                    // "dagen dat ik niet meer wil"
  /\bniet meer wakker\s*(te\s*)?word/i,                    // "niet meer wakker worden"
  // "stoppen/kappen" only counts as a CRISIS hit when qualified — bare "ermee
  // stoppen" means quitting ANYTHING (a parking complaint "ik wil ermee stoppen"
  // was mislabelled crisis → 113). The resignation marker "gewoon" near "mee …
  // stoppen" (allowing words between, e.g. "er gewoon helemaal mee te stoppen")
  // OR a life/totality phrase ("met alles / met het leven stoppen") qualifies.
  /\bgewoon\b[^.!?]{0,25}\b(?:er\s?mee|ermee|mee)\b[^.!?]{0,8}\b(?:stoppen|kappen)\b/i,
  /\bmet\s?(?:alles|(?:het|dit|mijn)\s?leven)\s*(?:willen\s*)?(?:stoppen|kappen)\b/i,
  /\bhoeveel pillen\b/i,                                   // planning
  /\bpillen\b.{0,20}\b(opgespaard|verzameld|genoeg|tegelijk|allemaal)\b/i, // overdose-specific (not "pillen aannemen")
  /\bgeen uitweg\b/i, /\b(zoek|heb)\s+een uitweg\b/i,
  // "het niet meer zien zitten" — allow inverted word order ("zie ik het …")
  // and intervening words (Task-1 smoke missed "zie ik het soms niet meer zitten").
  /\b(?:zie|ziet|zien|zag)\b[^.!?]{0,15}\bhet (?:echt |soms |allemaal |gewoon )?niet meer (?:zo )?zitten\b/i,
  /\bgeen zin meer in (het )?leven\b/i,
  /\bhet (leven )?niet meer aankan\b/i,
  // passive hopelessness (the civic r4 widower miss): "weet niet meer waar ik
  // het (nog/allemaal) voor doe" — requires the negation so the positive
  // "ik weet waar ik het voor doe" doesn't fire.
  /\bniet meer\b[^.!?]{0,20}\bwaar ik het (?:nog |allemaal )?voor doe\b/i,
  /\bwaar doe ik het (?:nog|allemaal|in vredesnaam) (?:nog )?voor\b/i,
  // indirect "if I were gone" + self-harm + pill-counting (patient diaries)
  /\bals ik er (gewoon )?niet meer (was|ben|zou zijn)\b/i,
  /\ber niet meer (was|zou zijn)\b/i,
  /\bmakkelijker\b.{0,30}\bniet meer (was|ben|zou zijn|leven)\b/i,
  /\bmezelf\b.{0,12}\b(gekrabd|gesneden|gesnijd|beschadig|verwond|pijn gedaan)\b/i,
  /\bmezelf (snij|krab|brand)/i,
  /\bpillen\b.{0,30}\b(bij elkaar|geteld|tellen|achtergehouden|bewaard)\b/i,
  /\ber (is|was) (een|de) uitweg\b/i, /\been uitweg\b.{0,15}\b(als het|is|heb)\b/i,
  /\bniet meer de moeite waard\b/i,
  // English self-harm / indirect
  /\bcut(ting)? myself\b/i, /\bself[- ]?harm/i,
  /\b(better|easier) if i (was|were) (gone|not here|not around|dead)\b/i,
  // English — direct + indirect
  /\bwant to die\b/i,
  /\b(kill|hurt|harm) myself\b/i,
  /\bend it all\b/i, /\bend my life\b/i, /\bend the pain\b/i,
  /\bno reason to live\b/i,
  /\bdark thoughts\b/i,
  /\bsuicid/i,
  /\bdon'?t want to (live|be here|go on|exist|wake up)\b/i,
  /\b(did\s?n.?t|not|never)\s+wake up\b/i,                 // "easier if I didn't wake up"
  /\bbetter off (dead|gone|without me)\b/i,
  /\b(can'?t|cannot|shouldn'?t|wo n'?t|won'?t)\s+keep going\b/i,
  /\bnot worth (living|it any ?more)\b/i,
  /\bhow many pills\b/i,
  /\bgive up on (life|everything)\b/i,
];

const SAFETY = [
  // Dutch — widened after the stress test (w5 "wachten op een dode" slipped past)
  /\bdodelijk(e)?\b/i,
  /\blevensgevaarlijk\b/i, /\blevensgevaar\b/i,
  /\bwachten op (een )?(dode|dooie|ongeluk|ramp|slachtoffer)\b/i,
  /\bvalt (er )?(straks )?.{0,25}\bnaar beneden\b/i,
  /\biemand (gaat|raakt|kan|wordt) .{0,15}\b(dood|gewond|eraan)\b/i,
  /\bernstig (gewond|letsel)\b/i,
  /\bbrandgevaar\b/i, /\binstortingsgevaar\b/i, /\bontploffing(sgevaar)?\b/i,
  /\bveiligheid\w*\b.{0,30}\b(genegeerd|gerommeld|geschonden|niet op orde)\b/i,
  // OBJECTIVE "niet veilig" only — the SUBJECTIVE "(ik) voel me niet veilig" is a
  // mild civic complaint (a broken streetlight), not an escalation (over-escalation
  // in the civic scorecard). Require an objective subject.
  /\b(het is|hier is het|de (situatie|werkplek|plek|machine|steiger|installatie)\w* is)\b[^.!?]{0,18}\bniet (meer )?veilig\b/i,
  // English
  /\bfatal accident\b/i,
  /\blife[- ]threatening\b/i,
  /\b(serious|severe) injury\b/i,
  /\bsomeone (will|could|is going to|might) (get|be) (killed|hurt|injured)\b/i,
  // genuine road-/public-safety hazards the civic run missed (bike lane, crossing)
  /\bbefore (someone|somebody) (dies|gets killed|gets hurt|is killed)\b/i,
  /\bsomeone (will|could|is going to|might|is about to) die\b/i,
  /\b(bijna|net niet) (geschept|aangereden|overreden|gegrepen|van de sokken gereden)\b/i,
  /\bvoordat (er )?(hier )?(iemand|een kind)\b[^.!?]{0,15}\b(sterft|doodgaat|omkomt|onder.{0,6}komt)\b/i,
  /\bdeath trap\b/i, /\babout to collapse\b/i, /\bfire hazard\b/i,
  /\bsafety (is|are|being|gets) (ignored|violated|compromised)\b/i,
];

// Self-fingerprinting phrasings ("the only X who Y") — a re-identification
// risk even after names are removed (G3). Negative lookbehind excludes the
// NEGATED form "niet de enige" / "not the only" (b2 false positive).
const REIDENT = [
  /\bde enige\b/i,
  /\bals enige\b/i,
  /\bthe only\b/i,
  /\bonly one (here|who|on)\b/i,
  /\bno one else (like me|here)\b/i,
  /\bliterally no one else\b/i,
  /\bniemand anders (zoals ik|hier)\b/i,
];
// NEGATED self-id ("ik ben NIET de enige", "not the only one") is the opposite
// of self-identifying — strip it before testing (b2 false positive).
const REIDENT_NEGATION = /\b(niet|geen)\s+de\s+enige\b|\bnot\s+the\s+only\s+(one\s+)?/gi;

// Sensitive themes: a below-threshold theme in one of these is QUARANTINED for
// human review (not deleted), so a lone serious report can't vanish.
const SENSITIVE_DOMAIN = /safe|harass|intimidat|integrity|fraud|corrupt|abuse|discriminat|self.?harm|crisis|suicid|danger|threat|violence|veilig|misbruik|intimidat|fraude|corrupt|discrimin|zelfdod|geweld|bedreig/i;

function matchAll(text, patterns) {
  const matches = patterns.filter((re) => re.test(text)).map((re) => re.source);
  return { hit: matches.length > 0, matches };
}

// Sensitive CONTENT in the raw text — used to quarantine a below-threshold
// report even when the LLM mislabelled its domain as something mundane (the
// stress test: w9's discrimination report was labelled "workload" and dropped).
// Run on RAW text (cleaning may have generalised the give-away phrasing).
const SENSITIVE_CONTENT = [
  // harassment / discrimination / abuse
  /\b(seksuel|sexual|intimidat|harass|discriminat|gepest|pesten|bullie|misbruik|abuse|vernederd|humiliat|ongewenst|racis|aanrand|assault|grensoverschrijdend|treiter)/i,
  // integrity / fraud
  /\b(fraude|fraud|corrupt|omkop|steekpenning|bribe|vervals|falsif|witwas|embezzl|vriendjespolitiek|belangenverstrengeling|diefstal|stealing)/i,
  // retaliation / threats
  /\b(represaille|retaliat|bedreig|\bthreat|wraak)/i,
  // health-condition — a disclosed medical / mental-health condition or disability (a sensitive
  // personal grievance, not an emergency → REVIEW, don't drop below threshold).
  /\b(diagnos|chronische?\s+ziekte|aandoening|burn.?out|depress|psychisch|geestelijke gezondheid|mental health|disabilit|arbeidsongeschikt|chronic(?:ally)?\s+ill|medical condition)/i,
  // financial-hardship
  /\b(schulden|loonbeslag|armoede|bijstand|niet\s+(?:kunnen\s+)?rondkomen|financi[eë]le?\s+(?:nood|problem)|\bdebt\b|poverty|can'?t afford|financial hardship)/i,
  // pay-inequality (single-user version of the discrimination floor — keeps grievances like e4 in review)
  /\b(loonkloof|ongelijke?\s+(?:loon|beloning|betaling)|onderbetaald|salarisverschil|voor hetzelfde werk\s+\w+\s+(?:minder|meer)|pay gap|underpaid|unequal pay|paid less)/i,
  // child-welfare — a welfare CONCERN about a minor (not any mention of children)
  /\b(jeugdzorg|kinderbescherming|verwaarloos|kindermishandel|child\s+(?:welfare|protection|neglect)|onveilig\w*\W+\w*kind|kind\w*\W+\w*onveilig)/i,
];

// A message that is mostly "contact me directly" + contact details and no real
// allegation (refinement A — the red-team's w10 was such a message but got
// LLM-labelled "fraud" and inflated the statistical count). These get their own
// track instead of being swept into a theme. A contact-request that ALSO has
// real substance (sensitive content) is NOT pulled out — it stays a report.
const CONTACT_REQUEST = [
  /\bneem (even )?contact (met (me|mij) )?op\b/i,
  /\bcontact met (me|mij) op(neemt|nemen)?\b/i,
  /\b(bel|mail) (me|mij)\b/i,
  /\bje kunt me bereiken\b/i, /\bbereiken op\b/i,
  /\bstuur ik (de bewijzen|het|alles)\b/i,
  /\bcall me\b/i, /\breach me\b/i, /\bcontact me\b/i, /\bget in touch\b/i,
  /\bi('?ll| will) send (you )?(the )?(proof|evidence|details)\b/i,
];
export function detectContactRequest(text) { const r = matchAll(text, CONTACT_REQUEST); return { isContact: r.hit, matches: r.matches }; }

// Friendly reasons a message was quarantined — shown to the human reviewer so a
// soft/wrong theme label ("workload") doesn't lull them (refinement B).
export function sensitivityFlags(text) {
  const flags = [];
  if (detectReident(text).isReident) flags.push('self-identifying ("only X")');
  if (detectSensitiveContent(text).isSensitive) flags.push('sensitive content');
  return flags;
}

export function detectCrisis(text) { const r = matchAll(text, CRISIS); return { isCrisis: r.hit, matches: r.matches }; }
export function detectSafety(text) { const r = matchAll(text, SAFETY); return { isSafety: r.hit, matches: r.matches }; }
export function detectReident(text) {
  const r = matchAll(text.replace(REIDENT_NEGATION, ' '), REIDENT);
  return { isReident: r.hit, matches: r.matches };
}
export function detectSensitiveContent(text) { const r = matchAll(text, SENSITIVE_CONTENT); return { isSensitive: r.hit, matches: r.matches }; }
export function isSensitiveDomain(domain) { return SENSITIVE_DOMAIN.test(domain || ''); }
