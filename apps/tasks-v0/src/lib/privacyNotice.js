/**
 * Closed-beta privacy-notice content (Tasks V1+V2).
 *
 * Mirrors Pinboard's `apps/pinboard/src/lib/privacyNotice.js` shape:
 * `{lang: [{heading, body}, ...]}` — apps render each item as a
 * heading + paragraph block on a /privacy.html page (or in an
 * onboarding modal).
 *
 * Authoring rule: the SAME items appear in every supported
 * language, in the same order. Translations are hand-authored;
 * this is the source of truth for both nl + en. When adding an
 * item, update both.
 *
 * Items 1-4 are inherited from Pinboard's notice (encryption, relay
 * surface, abuse-tracing, group governance) — Tasks's network
 * footprint mostly mirrors Pinboard's, so the user-facing language
 * doesn't need to diverge for those.
 *
 * Items 5-6 cover V1-era Tasks-specific pod-data flows:
 *   - Calendar read stays local (no network freebusy).
 *   - Pod-data-sharing caution principles (skills, deliverables) —
 *     defaults explicitly opt-in per circle.
 *
 * Items 7-9 added 2026-05-08 for the V2 pod paths:
 *   Calendar emission — VEVENT files written to your own pod.
 *   Invoicing — paid-pro lines on the circle pod.
 *   Availability hints — coarse half-day chips on the circle pod.
 */

export const PRIVACY_NOTICE = Object.freeze({
  nl: Object.freeze([
    {
      heading: 'Wat is versleuteld',
      body:    'De inhoud van je berichten wordt versleuteld voordat ze het apparaat verlaten. ' +
               'De relay-operator (de server die berichten doorgeeft) kan ze niet lezen.',
    },
    {
      heading: 'Wat de relay wel ziet',
      body:    'De relay weet welke leden online zijn en hoe vaak ze berichten verzenden. ' +
               'Verkeer-metadata (timing, volume, ontvangers) is niet versleuteld.',
    },
    {
      heading: 'Misbruik en aansprakelijkheid',
      body:    'Iedere admin van een circle is verantwoordelijk voor wie er lid is. ' +
               'Bij ernstig misbruik kan een admin een lid verwijderen (of laten verwijderen door de relay-operator). ' +
               'Tasks heeft geen centrale moderator.',
    },
    {
      heading: 'Hoe groepen beheerd worden',
      body:    'Een circle is een gesloten groep met expliciete uitnodigingen. ' +
               'De admin van de circle bepaalt wie lid wordt en welke rol iemand krijgt. ' +
               'Lidmaatschap kan verlopen of worden ingetrokken.',
    },
    {
      heading: 'Je agenda blijft op je apparaat',
      body:    'Tasks leest jouw agenda lokaal — een externe import-bridge schrijft .ics-bestanden naar je pod, ' +
               'maar Tasks deelt die agenda nooit met andere circle-leden. ' +
               'Je krijgt alleen zelf je conflicten te zien wanneer je een taak claimt.',
    },
    {
      heading: 'Voorzichtig met pod-data delen',
      body:    'Skills, deliverables en agenda-data zitten op je eigen pod. ' +
               'Tasks deelt geen van die items automatisch met andere circles; je kiest per circle expliciet wat je deelt. ' +
               'De ACP\'s van je pod zijn de uiteindelijke verdedigingslinie.',
    },
    {
      heading: 'Agenda-uitvoer (V2.1) — alleen op je eigen pod',
      body:    'Wanneer een admin "Agenda-koppeling" aanzet, schrijft Tasks een per-lid `.ics`-bestand naar ' +
               '`<jouw-pod>/tasks/calendars/<circleId>.ics` met je toegewezen + master-taken. ' +
               'Andere leden zien dit bestand niet — alleen jij abonneert er met je telefoonagenda op. ' +
               'De URL is niet versleuteld; iedereen die de URL achterhaalt kan meelezen, ' +
               'dus deel hem alleen met agenda-apps die je vertrouwt.',
    },
    {
      heading: 'Vergoeding-regels (V2.2) — alleen voor admins en de paid-pro',
      body:    'In circles met "Vergoeding bijhouden" aan, krijgt elke afgeronde taak van een paid-pro-lid ' +
               'een regel in `<circle-pod>/tasks/invoicing/<webid>/<jaarmaand>.json`. ' +
               'De rol-policy beperkt het lezen tot admins en de paid-pro zelf; ' +
               'andere leden krijgen 403. Het bedrag (uren × tarief) is informatief — Tasks is geen factureerapp.',
    },
    {
      heading: 'Beschikbaarheid-hints (V2.3) — grof, opt-in per circle',
      body:    'Hints zijn één van vier waarden (`open` / `tight` / `unavailable` / `unknown`) ' +
               'per (lid, ISO-week, halve dag), opgeslagen in `<circle-pod>/tasks/availability/<webid>.json`. ' +
               'Coördinatoren zien jouw chips wanneer ze een toewijzing kiezen — alleen wanneer je per-circle opt-in hebt aangezet. ' +
               'Niet-opted-in leden zijn niet te onderscheiden van opted-in-maar-leeg (beide tonen `unknown`).',
    },
    {
      heading: 'Camera (mobile) — alleen wanneer je hem opent',
      body:    'De Tasks-app vraagt camera-toegang bij het scannen van een uitnodigings-QR of het maken van een ' +
               'deliverable-foto. Foto\'s worden lokaal verkleind (1280 px) en alleen na "Indienen" naar je pod ' +
               'geschreven. Tasks streamt of uploadt geen camera-feed automatisch.',
    },
    {
      heading: 'Pushmeldingen (mobile) — opt-in per gebeurtenis',
      body:    'Als je pushmeldingen aanzet, registreert Tasks een Expo-pushtoken en vraagt de relay je te wekken voor ' +
               'gebeurtenissen die je per type kunt aan/uitzetten (deadline-nadering, taak geclaimd, indiening afgewezen, ' +
               'sub-taakvoorstel). De inhoud van de melding is minimaal — geen taaktekst, alleen "Tasks: er is iets nieuws".',
    },
    {
      heading: 'Native agenda (mobile) — alleen op jouw apparaat',
      body:    'Wanneer je in instellingen "Native agenda" of "Beide" kiest, schrijft Tasks events naar een eigen ' +
               '"Tasks"-agenda op het apparaat (via expo-calendar). Andere apps op je telefoon kunnen die agenda lezen ' +
               'als je hen toegang geeft; Tasks deelt de events nooit verder. Je kunt de Tasks-agenda altijd verwijderen ' +
               'in de systeem-agenda-instellingen.',
    },
    {
      heading: 'Locatietoegang (Android) — voor BLE peer-detectie',
      body:    'Tasks vraagt op Android locatietoestemming omdat dat een Android-vereiste is voor Bluetooth-Low-Energy ' +
               'peer-detectie (taken kunnen lokaal claimen zonder relay). De app slaat je locatie nooit op en stuurt hem niet door.',
    },
  ]),

  en: Object.freeze([
    {
      heading: 'What is encrypted',
      body:    'Message content is encrypted before it leaves your device. ' +
               'The relay operator (the server that forwards messages) cannot read it.',
    },
    {
      heading: 'What the relay does see',
      body:    'The relay knows which members are online and how often they send messages. ' +
               'Traffic metadata (timing, volume, recipients) is not encrypted.',
    },
    {
      heading: 'Abuse and accountability',
      body:    'Each circle admin is responsible for who is a member. ' +
               'In serious abuse cases, an admin can remove a member (or have the relay operator do so). ' +
               'Tasks has no central moderator.',
    },
    {
      heading: 'How groups are managed',
      body:    'A circle is a closed group with explicit invitations. ' +
               'The admin chooses who joins and what role they get. ' +
               'Memberships can expire or be revoked.',
    },
    {
      heading: 'Your calendar stays on your device',
      body:    'Tasks reads your calendar locally — an external import-bridge writes .ics files to your pod, ' +
               'but Tasks never shares that calendar with other circle members. ' +
               'You only see your own conflicts when claiming a task.',
    },
    {
      heading: 'Be careful sharing pod data',
      body:    'Skills, deliverables, and calendar data live on your own pod. ' +
               'Tasks does not automatically share any of those items with other circles; you opt-in per circle. ' +
               'Your pod\'s ACPs are the ultimate line of defence.',
    },
    {
      heading: 'Calendar emission (V2.1) — only on your own pod',
      body:    'When an admin enables "Calendar sync", Tasks writes a per-member `.ics` file to ' +
               '`<your-pod>/tasks/calendars/<circleId>.ics` containing your assigned + mastered tasks. ' +
               'Other members never see this file — only you subscribe to it from your phone calendar. ' +
               'The URL is not authenticated; anyone who learns the URL can read along, ' +
               'so share it only with calendar apps you trust.',
    },
    {
      heading: 'Invoicing lines (V2.2) — admins and the paid-pro only',
      body:    'In circles with "Track compensation" enabled, every task a paid-pro member completes ' +
               'gets a row in `<circle-pod>/tasks/invoicing/<webid>/<isoMonth>.json`. ' +
               'The role policy restricts reads to admins and the paid-pro themselves; ' +
               'other members get a 403. The amount (hours × rate) is informational — Tasks is not a billing app.',
    },
    {
      heading: 'Availability hints (V2.3) — coarse, per-circle opt-in',
      body:    'Hints are one of four values (`open` / `tight` / `unavailable` / `unknown`) ' +
               'per (member, ISO-week, half-day), stored at `<circle-pod>/tasks/availability/<webid>.json`. ' +
               'Coordinators see your chips when picking an assignee — only when you\'ve opted in for that circle. ' +
               'Members who haven\'t opted in are indistinguishable from opted-in-but-empty (both show `unknown`).',
    },
    {
      heading: 'Camera (mobile) — only while you have it open',
      body:    'The Tasks app asks for camera access when you scan an invite QR or take a deliverable photo. ' +
               'Photos are resized locally (1280 px) and only written to your pod after you tap "Submit". ' +
               'Tasks does not stream or upload the camera feed in the background.',
    },
    {
      heading: 'Push notifications (mobile) — opt-in per event',
      body:    'If you enable push notifications, Tasks registers an Expo push token and asks the relay to wake you ' +
               'for events you can toggle per type (deadline approaching, task claimed, submission rejected, ' +
               'sub-task proposal). Notification bodies are minimal — no task text, just "Tasks: there\'s something new".',
    },
    {
      heading: 'Native calendar (mobile) — only on this device',
      body:    'If you pick "Native calendar" or "Both" in settings, Tasks writes events to a Tasks-owned calendar on ' +
               'your device (via expo-calendar). Other apps on your phone can read it if you grant them calendar access; ' +
               'Tasks never shares those events outward. You can remove the Tasks calendar from your system calendar settings.',
    },
    {
      heading: 'Location access (Android) — for BLE peer discovery',
      body:    'On Android, Tasks asks for location permission because Android requires it for Bluetooth-Low-Energy ' +
               'peer discovery (so tasks can claim locally without the relay). The app never stores or transmits your location.',
    },
  ]),
});

/**
 * Return the localised privacy notice. Falls back to `en` when an
 * unknown language is requested.
 *
 * @param {string} [lang='en']
 * @returns {Array<{heading: string, body: string}>}
 */
export function privacyNoticeFor(lang = 'en') {
  return PRIVACY_NOTICE[lang] ?? PRIVACY_NOTICE.en;
}
