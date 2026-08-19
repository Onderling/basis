# v3 interface-ontwerp — tier audit (board-by-board vs real repo state)

**Source doc:** `Onderling interface — interface-ontwerp · print.pdf` (repo root) — the
standalone v3 design conversation, 11 sections / 34 sketches. This is the doc the
todo's **N4** asked to import and tier-label.

**Canon status.** v3 is **canon *alongside* the v2 PDF** (`Onderling interface · v2 —
kring als bouwsteen · print.pdf`), not a replacement. v2 ("kring als bouwsteen")
remains the GESPREK-is-the-kring-view canon; v3 only *extends* it — same single
codebase, same kring substrate underneath. Where v3 and the shipped app diverge,
the app's evolution (e.g. α Screens replacing a literal "Stroom" tab) is the
current truth and v3's sketch is the older intent.

**What this fills.** Every board in the PDF carries an empty `◌ TIER · ?` /
`TIER · IN TE VULLEN` badge. This table assigns each the real tier.

## Legend

| Tier | Meaning |
|------|---------|
| 🟢 | Built & real in the repo (cites the implementing substrate / task) |
| 🟡 | Partial, or shipped in an *evolved* form that diverges from the sketch |
| 🔴 | Not built — parked, product/store-level, or backend-only (no in-app UI) |

---

## §1 · De kring — de bouwsteen

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 1 · recap — "kring = groep met gekozen vorm" (3 clusters: Wie&toegang / Vorm / Beleid) | 🟢 | `circlePolicy.js` (features · revealPolicy · pod · llmTool · agents) + create-wizard kind/size/policy (N1, #197). |
| 1 · EÉN SCHIL — launcher (Kringen / Stroom / Mij · + nieuwe kring · "NIEUW IN V3 Stroom-tab") | 🟡 | Launcher + Kringen/Mij tabs 🟢 (β.1–3, #389). The advertised **Stroom** tab was **retired in favour of α Screens** (`circleApp.js:798`, `circleTabBar.js:10`) — see §5B. |

## §2 · Eén motor, meerdere pakketten in de store

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 2A · store-landing — Onderling / Circle / Huishouden / OR-bot pakketten | 🔴 | Product/store-packaging strategy. One app today; no multi-package store listing. |
| 2B · twee niveaus schil — kring-kiezer verborgen vs aanwezig | 🔴 | No package-level shell variant (hide kring-switcher / pin-one-kring). |
| 2C · gemengd deelnemerschap · zelfde pod (Anne Circle-app + Bob volle Onderling) | 🟡 | "Data leeft op de pod" is real (pod-storage, cross-pod refs). The *mixed-package* membership it illustrates is 🔴. |

## §3 · Eerste momenten

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 3A · eerste opening (Welkom · 12-woorden sleutel · 3 op zelfde wifi) | 🟢 | Mnemonic create/restore (5.9b, #347 `MnemonicCreateScreen`); local wifi discovery (5.9c mDNS). No-account/no-profile boot is the real flow. |
| 3B · wizard vraag 4 · conflict-aanpak (6 vragen · gevolgen per optie) | 🟢 | Create-group wizard (#197 C1, 5.5a `createGroupState`) + consequence ⓘ per option (N2 `optionConsequences`). |
| 3C · rules.md — wat een nieuw lid ziet vóór 'akkoord' | 🟢 | Join-group consent wizard (#196 C2, 5.5b) — structured rules doc + Agree/Decline. |
| 3D · raadgever (drie maanden later · drempel · signaal van leden) | 🟢 | `circleAdvisor.js` — `computeAdvice` / `makeTooBusyEvent` threshold gating (advisor card). |

## §4 · Kring-instellingen · vijf assen

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 4A · vijf assen (Functies / LLM-tool / Agents / Onthulling / Pod · consensus · toon-verschil) | 🟢 | Functies, LLM-tool (5.8`selectLlmClient`), Agents axis, Onthulling/reveal, Pod (5.4 tiered policy IO), 2-admin consensus voorstel + "Voorstel sturen" (#341). |
| 4B · agents · "agent toevoegen" verzoek (goedkeur / weiger) | 🟢 | Agent-add admin-approval inbox (, #348`addAgent`). |
| 4C · bekijk als… (wat ziet een ander van jou) | 🟢 | `circleViewAs.js` — WHAT THEY SEE / DON'T split (5.1). |

## §5 · Chat per kring én één stroom

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 5A · standaard per kring (kring-lijst met previews) | 🟢 | Chat embedded in the kring's GESPREK view; tile activity preview + unread. |
| 5B · één stroom · cross-kring-stroom AAN (alles op één tijdlijn) | 🟡 | The literal "Stroom" tab was **retired**; the cross-kring-timeline intent is served by **α Screens** (per-user `ScreenBook` multi-kring materializer) + `circleStream.js` / `catchUpProvider.js`. Concept shipped, *different surface* than the sketch. |
| 5C · wederkerigheid (Bob chat uit · Anne tikt 'm aan) | 🟢 | Wederkerigheid notice + chat-off consumer side (#343). |

## §6 · Persoonlijke afwijking

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 6A · Bob's overrides (chat-draden · push @jou/elk · onthulling-afwijking · agents · doorstroom) | 🟢 | Personal override: @-mention vs all-message push split, claim→Mijn-dingen doorstroom, per-kring reveal override. |
| 6B · Anne vs Bob · zelfde kring, andere ervaring | 🟢 | Override application diverges the view; claim "via Selwerd" lands on personal task list (#342). |
| 6C · vakantiestand + stilte-uren (over alle kringen) | 🟢 | Holiday mode + auto-reply; quiet-hours`isSuppressed` (5.7b). |

## §7 · Hopping · tweedegraads via je contacten

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 7A · hop wordt zichtbaar · "1 mogelijke match HOP" · drie regels | 🟢 | Auto-hop-prompt when no in-circle match (#344);`circleHop.js` `buildHopChain` / `MAX_HOPS=1` / anonymised relay. |
| 7B · Bert's hop-instellingen · per contact (Uit / Aan-met-goedkeuring / Altijd) | 🟢 | Per-contact hop override (, #336`contactHopOverrides.js`); respects Stoop trust-tiers. |

## §8 · Skill-vragen en -aanbod · het circle-stuk

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 8A · een skill aanmaken (openheid · houding · status · radius) | 🟢 | `circleSkills.js` `SKILL_AXES` (openness/posture/status/radius) + consequence ⓘ (N2.b); `CircleSkillEditorScreen`. |
| 8B · skill-match in actie (mens + agent in één lijst · VIA HOP) | 🟢 | `buildSkillMatches` `MATCH_SOURCES` inline match list under posted question (#345). |
| 8C · lokale ontdekking · op de circle-BBQ (wifi/BLE · 5 mensen · geen GPS) | 🟢 | Nearby screen + mDNS skill broadcast + HIER tab (#346); presence-v0 (5.9c/5.9d). |

## §9 · 'Anne komt erbij wonen' — de cross-kring-test

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 9A · J3-journey kring-gewijs (lid maken · map delen · taak · 3 bevestigingen) | 🟢 | Doc itself notes it's "al ingebakken als follow-up-knoppen ". Tasks/Folio/Calendar run in kring context; claim doorstroom to "Mijn dingen" is the "echte test". |

## §10 · Folio · privé én groep, plus toegangsvereiste-plek

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 10A · Mijn dingen · notes-vorm (privé-kring) | 🟢 | `folioMyThings.js` — My-things notes-list as private kring (#349). |
| 10B · drive-achtig in groep-kring (bladeren · favorieten/recent · gedeeld door/met mij · uploaden) | 🟢 | Circle-Folio browser (5.2) + share filters + **folder nav + breadcrumbs + rich rows (N5, web`2e7193e4` / mobile `ecab3b12`)**. Caveat: the **"+ uploaden"** affordance is 🔴 on web (mobile has the doc-picker, #267). Local↔remote-pod **source toggle** still pending — and it is **not** blocked on #167: it needs only the existing signed-in OIDC pod session, pod-backing folio's `listFiles` via the `podClient` seam already present in `createBrowserFolioAgent` (marked "future work"). #167 (provisioned test creds) only gates an *automated* end-to-end test of that leg, which stays env-gated like `journeys-pod.test.js`. |
| 10C · toekomst-plek · proof-of-location (claim binnen 50 m · getuige-netwerk) | 🔴 | Parked by design — doc marks it "VERKENNING · NIET GEBOUWD". Only a PoL placeholder row exists (5.9d presence-v0 seam). |

## §11 · Co-redactie · de consent-diff-kaart

The 7-state consent-diff flow (wacht-op-review → diff → ongewijzigd → zelf-bewerken
→ geblokkeerd → sluitstuk → Telegram-bot weergave).

| Sketch | Tier | Evidence / note |
|--------|------|-----------------|
| 11.1 wacht op review | 🔴 | No consent-diff-kaart UI in basis. |
| 11.2 diff · wijzigingen | 🔴 | " |
| 11.3 ongewijzigd doorlaten | 🔴 | " |
| 11.4 zelf bewerken | 🔴 | " |
| 11.5 geblokkeerd | 🔴 | " |
| 11.6 sluitstuk · wat ging eruit | 🔴 | " |
| 11.7 zelfde kaart · Telegram-bot | 🔴 | Cross-surface (TG renderer) — not built. |

> The **redaction backend** this section dramatises (name-stripping, krachtterm-softening,
> k-anonymity aggregation threshold) is being explored in the untracked **`apps/feedback-pipeline/`**
> (results-*.md scenario runs). It is a separate pipeline app; none of it is wired into a
> basis consent-diff-kaart UI yet. §11 is the largest unbuilt block in v3.

---

## Tally

| Tier | Count | Sketches |
|------|-------|----------|
| 🟢 | 21 | 1-recap · 3A 3B 3C 3D · 4A 4B 4C · 5A 5C · 6A 6B 6C · 7A 7B · 8A 8B 8C · 9A · 10A 10B |
| 🟡 | 3 | 1-launcher (Stroom→Screens) · 2C (pod real, packages not) · 5B (Stroom→Screens) |
| 🔴 | 10 | 2A 2B · 10C · 11.1–11.7 |

**Reading:** the *kring substrate* of v3 (sections 1, 3–9, 10A/B) is essentially
shipped — 21/34 boards are real, 3 more shipped in an evolved form. The unbuilt
remainder clusters in two places, both **out of scope by design**:

1. **Store / packaging** (2A, 2B) — a product-distribution concern, not a kring feature.
2. **Co-redactie** (§11, 7 boards) — the OR-bot commercial feedback product; backend
   under exploration in `apps/feedback-pipeline`, no basis UI.

Plus two small genuine gaps inside shipped areas: Folio **web upload** (10B) and
**proof-of-location** (10C, intentionally parked behind a placeholder).
