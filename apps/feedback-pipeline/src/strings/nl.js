// Dutch participant-facing strings. ALL user-visible text for the channel surfaces lives
// here (and in the sibling locale files) — files never hardcode prose; they call these
// keys. To add a language, copy this file and translate; register it in ./index.js.
// (Internal lexicons/prompts/placeholders are not participant copy and stay in their
// own modules.) Support resources like a crisis phone number come from the project config,
// not here, because they are jurisdiction- and project-specific.

export default {
  received: 'Ontvangen ✓. Stuur gerust meer, of typ /klaar om je punten te bekijken.',
  rejected: (reason) => `Dit bericht is niet opgeslagen (${reason}). Pas het gerust aan en stuur opnieuw.`,

  reviewIntro: 'Dit zijn je punten. Wat wil je delen?',
  reviewEmpty: 'Er zijn nog geen punten om te bekijken. Stuur eerst een bericht.',
  consentOne: (n) => `Verstuur ${n}`,
  consentAll: 'Alles versturen',
  cancel: 'Niets versturen',

  escalationOffer: 'Het lijkt of dit om iets dringends gaat. Wil je dat we dit signaal doorgeven?',
  escalateYes: 'Ja, doorgeven',
  escalateNo: 'Nee, alleen bewaren',

  submitted: (n) => `${n} bijdrage(n) opgeslagen ✓. Typ /menu voor je opties.`,
  submittedEmpty: 'Er is niets verstuurd.',
  // dit project vereist een geverifieerde identiteit, die dit kanaal niet kan bieden
  verificationRequired: 'Dit project accepteert alleen bijdragen van een geverifieerde identiteit. Doe mee via de canopy-app, die je bijdrage op je eigen apparaat ondertekent.',
  consentFailed: (n) => `${n} bijdrage(n) konden niet worden opgeslagen en zijn niet verstuurd. Er is niets bewaard.`,

  contributionsHeader: 'Je bijdragen:',
  contributionLine: (n, text, id) => `${n}. ${text}  —  /intrekken ${id}`,
  contributionsEmpty: 'Je hebt nog geen bijdragen verstuurd.',
  withdrawn: (id) => `Ingetrokken: ${id}.`,

  comingSoon: 'Deze optie komt binnenkort.',
  downloadReady: (n) => `Je ${n} bijdrage(n) — jouw eigen kopie:`,
  deleted: (n) => `${n} bijdrage(n) van jou verwijderd.`,
  pauseDone: 'Je deelname is gepauzeerd. Stuur wanneer je wilt een bericht om verder te gaan.',
  claimDone: 'Deze pod staat nu op jouw identiteit.',
  notSupported: 'Deze optie is niet beschikbaar voor jouw pod.',

  // bot-level (menu / help / acknowledgements)
  menuWelcome: 'Welkom. Stuur je bericht, of kies hieronder.',
  menuReview: 'Bekijk mijn punten',
  menuMine: 'Mijn bijdragen',
  help: [
    'Zo werkt het:',
    '• Stuur je bericht(en). We schonen ze op en bewaren niets totdat jij akkoord geeft.',
    '• /klaar — bekijk je punten en kies wat je deelt.',
    '• /mijn — je verstuurde bijdragen.',
    '• /intrekken <id> — een bijdrage terugtrekken (zolang die nog niet is verwerkt).',
  ].join('\n'),
  cancelAck: 'Niets verstuurd. Je punten blijven alleen bij jou.',
  escalateYesAck: 'Dank je. We geven dit signaal door aan wie er over gaat.',
  escalateNoAck: 'Begrepen. We bewaren het alleen, we geven niets door.',

  // curator workspace (the editor/steward reviewing + releasing the aggregate)
  curator: {
    reportTitle: (id) => `Rapport ${id}`,
    themesHeading: "Thema's in dit rapport",
    noThemes: "Geen thema's boven de drempel.",
    themeLine: (theme, n, summary) => `• ${theme} (${n} ${n === 1 ? 'deelnemer' : 'deelnemers'})\n${summary}`,
    transparencyHeading: 'Verantwoording',
    transparency: (c) => [
      `${c.participants} deelnemers, ${c.contributions} bijdragen.`,
      `${c.themesIncluded} thema's opgenomen` + (c.themesDroppedByCurator ? `, ${c.themesDroppedByCurator} door de redactie weggelaten` : '') + '.',
      `${c.themesBelowThreshold} thema's te klein om te tonen (drempel ${c.kThreshold})` + (c.quarantined ? `, waarvan ${c.quarantined} apart beoordeeld` : '') + (c.quarantineReleased ? ` (${c.quarantineReleased} alsnog opgenomen)` : '') + '.',
      `${c.signals} signalen doorgegeven, ${c.rejected} berichten geweigerd.`,
    ].map((l) => `• ${l}`).join('\n'),
    // M13 — de beoordeel-weergave van de redacteur (vóór publicatie)
    reviewTitle: (id) => `Rapport ${id} — beoordeling`,
    statusIncluded: 'opgenomen', statusExcluded: 'weggelaten',
    quarantineHeading: 'Apart beoordeeld (onder de drempel)',
    statusHeld: 'vastgehouden', statusReleased: 'vrijgegeven',
    signalsHeading: 'Signalen → bestemmingen',
    signalLine: (signal, severity, dest, confirmed) => `• ${signal} (${severity}${confirmed ? '' : ', onbevestigd'}) → ${dest}`,
    noDestination: '(geen bestemming ingesteld)',
    releaseHint: 'Publiceren maakt het rapport openbaar en stuurt de signalen naar hun bestemmingen.',
  },
};
