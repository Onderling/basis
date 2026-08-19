/* techniek-thuis.js — verdieping voor de thuis-ring. Welke data-
   items spelen er, welke toegang is hier logisch, welke ingangen
   zijn er. Verwijst naar de overzichtspagina voor de fundamenten. */
window.ONDERLING_PAGE = {
  key: "thuis",
  title: "Thuis, technisch gezien",
  blocks: [
    { type: "backlink", href: "thuis.html", label: "Thuis" },

    {
      type: "hero",
      heading: "Thuis, technisch gezien",
      lead:
        "Wat er bij een huishouden onder de motorkap zit. Voor de " +
        "fundamenten waar dit op rust — eigen ruimtes, ingangen, " +
        "toegangsrechten — staat het hele model op " +
        "[techniek](techniek.html); deze pagina vult specifiek het " +
        "huishouden in."
    },

    {
      type: "prose",
      heading: "De data-items",
      paragraphs: [
        "Een huishouden bestaat uit een handjevol soorten gegevens. " +
        "Geen losse apps eromheen — gewoon gegevens, elk met hun eigen " +
        "vorm en hun eigen toegangsregels:"
      ],
      list: [
        "**Gedeelde lijsten** — boodschappen, klusjes, dingen die op " +
        "raken. Iedereen in het huishouden mag erbij, iedereen mag " +
        "toevoegen of afvinken. Wie wat heeft toegevoegd staat erbij.",
        "**Taken** — iets dat aan iemand wordt toebedeeld (de " +
        "wasruimte deze week, de vuilnis), of dat op iemand wacht. " +
        "Met een spoor van wie het wanneer heeft opgepakt of " +
        "afgerond.",
        "**Afspraken en herinneringen** — soms gedeeld (we eten " +
        "vanavond samen), soms persoonlijk (ik moet eraan denken om " +
        "de fietssleutel mee te nemen). Persoonlijke herinneringen " +
        "staan in jouw ruimte; de anderen zien ze niet.",
        "**Gespreksflarden met de assistent** — vragen die je tussen " +
        "neus en lippen door stelt (\"wanneer was Sam aan de beurt?\"), " +
        "verzoeken (\"zet melk op de lijst\"). Wat naar de gedeelde " +
        "lijst hoort gaat erheen; de rest blijft in jouw ruimte."
      ]
    },

    {
      type: "prose",
      heading: "Wie heeft toegang waartoe",
      paragraphs: [
        "Een huishouden is een kleine circle met veel wederzijds " +
        "vertrouwen. De toegangsstructuur weerspiegelt dat: huisgenoten " +
        "hebben standaard toegang tot het gedeelde, en niet tot het " +
        "persoonlijke. Geen ingewikkelde rollen, geen aparte rechten " +
        "per item — gewoon twee niveaus: dingen die van iedereen zijn, " +
        "en dingen die van jou zijn.",
        "Eén persoon in het huishouden heeft beheerderstoegang — " +
        "diegene kan iemand toevoegen of verwijderen als die het " +
        "huishouden verlaat. Dat is geen \"baas\", het is iemand met " +
        "een sleutelfunctie. In de praktijk meestal de persoon die " +
        "het huishouden technisch heeft opgezet, maar het is " +
        "overdraagbaar."
      ]
    },

    {
      type: "prose",
      heading: "De ingangen",
      paragraphs: [
        "Er zijn op dit moment twee ingangen tot dezelfde gegevens. " +
        "De ene is een chat-assistent in een berichten-app die je toch " +
        "al gebruikt (nu Telegram; later wellicht ook andere). Je typt " +
        "in gewone taal, de assistent begrijpt wat je bedoelt en zet " +
        "het op de juiste plek. De andere is een scherm met lijstjes " +
        "en knoppen — voor wie liever klikt en tikt dan typt.",
        "Het is bewust geen óf-óf. Een huisgenoot die altijd via de " +
        "chat werkt en een huisgenoot die altijd het scherm gebruikt, " +
        "zien hetzelfde. De gedeelde lijst die de een via een berichtje " +
        "aanvult, ziet de ander op het scherm verschijnen — niet omdat " +
        "de twee ingangen elkaar berichten sturen, maar omdat ze beide " +
        "naar dezelfde plek kijken."
      ]
    },

    {
      type: "prose",
      heading: "Lokaal werkt het ook",
      paragraphs: [
        "Een huishouden hoeft niet bij een externe aanbieder " +
        "aangesloten te zijn om dit te laten werken. De gegevens " +
        "kunnen ook op een toestel in huis staan — een oud laptopje, " +
        "een kleine server, een Raspberry Pi — waar de huisgenoten " +
        "via het lokale netwerk bij komen. Geen abonnement, geen " +
        "internetverbinding strikt nodig.",
        "Dat is bewust de eenvoudigste vorm. Wie ermee wil beginnen " +
        "kan in feite klein starten en het later uitbreiden als " +
        "behoeften veranderen. Wil je later op afstand bij je " +
        "huishouden-gegevens, of wil je iets delen met een partner " +
        "die niet in huis woont, dan kan dat via een online plek of " +
        "een doorgeefluik — maar het is geen voorwaarde om te beginnen."
      ]
    },

    {
      type: "prose",
      heading: "De rol van slimme hulp",
      paragraphs: [
        "Een taalmodel speelt twee rollen, allebei optioneel. De " +
        "eerste is het begrijpen van wat je in gewone taal zegt: \"de " +
        "koffie is bijna op\" moet eindigen op de juiste lijst, niet " +
        "als een vrije notitie. De tweede is licht herhaalwerk " +
        "wegnemen: als de filters meestal samen met de koffie raken, " +
        "kan de assistent dat vragen, niet als regel maar als " +
        "vermoeden.",
        "Het taalmodel draait afgeschermd. Dat kan een model zijn dat " +
        "lokaal op je eigen toestel of in huis draait (geen verbinding " +
        "naar buiten), of een model in een omgeving waar niemand " +
        "anders meeleest. Welke variant is een keuze van het " +
        "huishouden, en niets dwingt je er een te gebruiken — een " +
        "huishouden dat alleen het scherm wil gebruiken kan dat ook."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Wat hier staat is hoe het bedoeld is. Een werkende versie " +
        "draait in een huishouden; sommige details (lokale-server-" +
        "opzet, overdraagbaarheid van beheerderstoegang) zijn " +
        "uitgewerkt op papier en nog niet in elke vorm " +
        "uitgeprobeerd. Zie [stand van zaken](stand-van-zaken.html)."
    }
  ]
};
