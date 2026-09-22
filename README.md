# PMR → SimGrid Results

Lokalny helper: telemetria UDP z **Project Motor Racing** → tabela jak formularz Race Results w SimGrid (+ JSON).

Nie wymaga SimHub. Działa tylko na Twoim PC: `http://127.0.0.1:3847`.

## Start

```bat
start.bat
```

albo:

```bat
node src\server.js
```

Otwórz [http://127.0.0.1:3847](http://127.0.0.1:3847).

## UDP w PMR

1. Settings → Preferences
2. UDP Enabled: On
3. Host: `127.0.0.1`
4. Port: ten sam co w helperze (zwykle `7580`)

SimHub też lubi brać `7580` — na czas zbierania wyników wyłącz SimHub albo zmień port w obu miejscach.

## Flow

1. Live klasyfikacja z gry
2. **Stop UDP** po fladze (albo automatycznie po SessionStopped)
3. Opcjonalnie **Kary po wyścigu** (sekundy → TOTAL TIME)
4. **Wygeneruj wyniki do SimGrid** → wgraj CSV + JSON entrylisty → tabela POS/NAME/CLASS/#/CAR/LAPS/BEST/TOTAL/DNF/DNS
5. Kopiuj TSV albo pobierz JSON

## Udostępnianie znajomemu

**GitHub Pages nie zadziała.** To nie jest strona statyczna — backend Node musi nasłuchiwać UDP na `127.0.0.1` na maszynie, na której leci PMR.

Znajomy potrzebuje:
1. sklonować / pobrać repo
2. mieć Node.js ≥ 18
3. uruchomić `node src/server.js` u siebie lokalnie
4. w swojej grze ustawić UDP na `127.0.0.1` + ten sam port

Możesz wrzucić kod na GitHub (repo prywatne/publiczne) — to tylko dystrybucja plików, nie hosting live.

## Pliki

- `src/` — UDP parser, sesja, entrylista, serwer
- `public/` — UI
- `data/` — ustawienia / kary / entrylista sesji (lokalne, nie commitowane)
