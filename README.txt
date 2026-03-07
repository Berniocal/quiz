TÝMY – ODPOVĚDI NA ČAS

Co upravit před nasazením:
1) V souboru app.js doplň vlastní Firebase konfiguraci do objektu firebaseConfig.
2) Ve Firebase zapni Realtime Database.
3) Doporučeně zapni Authentication -> Anonymous, aby šla použít přiložená pravidla.
4) Nahraj obsah této složky na GitHub Pages nebo Firebase Hosting.

Důležité:
- Přiložená pravidla jsou pro Realtime Database a počítají s tím, že uživatel je přihlášený anonymně.
- Aktuální app.js anonymní přihlášení sama nespouští. Pokud chceš opravdu použít tato přísnější pravidla, doplň do app.js ještě Firebase Auth s anonymous sign-in.
- Pokud chceš nejrychlejší rozběhnutí bez Auth, musíš pravidla uvolnit. To je ale méně bezpečné.

Doporučená úprava pro anonymous auth v app.js:
- přidej importy z firebase-auth.js
- zavolej signInAnonymously(auth) při startu aplikace

Struktura dat v databázi:
rooms/{kod}
  code
  createdAt
  hostClientId
  hostName
  status = lobby | round_active | round_stopped | finished
  currentRound
  roundStartedAt
  roundStoppedAt
  teams/{teamId}
    clientId
    name
    status = pending | accepted | rejected
    score
    joinedAt
  rounds/{roundNumber}/{teamId}
    answer
    elapsedMs
    submittedAt

Co aplikace umí:
- první telefon založí místnost a stane se hostem
- další týmy čekají na schválení hostem
- host spustí kolo a zastaví ho
- týmy pošlou jednu odpověď za kolo
- host po zastavení kola boduje plusy a mínusy
- lze spouštět další kola
- na konci se ukáže celkové pořadí
