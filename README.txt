TÝMY – ODPOVĚDI NA ČAS

Co je opravené:
1) Aplikace už se sama anonymně přihlásí do Firebase.
2) Opravené načítání, které předtím viselo na úvodní obrazovce.
3) Přidané ikony PWA.
4) Nová verze service workeru, aby se lépe přepsala stará cache.

Co zkontrolovat ve Firebase:
1) Realtime Database musí být zapnutá.
2) Authentication -> Sign-in method -> Anonymous musí být zapnuté.
3) Do Realtime Database -> Rules vlož pravidla a publikuj je.

Doporučená testovací pravidla:
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}

Nasazení:
- Nahraj obsah této složky na GitHub Pages nebo Firebase Hosting.
- Pokud jsi měl starší verzi aplikace, po nasazení ji otevři a udělej tvrdé obnovení.
- Když by se pořád načítala stará verze, smaž v prohlížeči data webu nebo odinstaluj starou PWA a znovu ji otevři.

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
