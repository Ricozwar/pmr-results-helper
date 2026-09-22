================================================================================
  PMR → SimGrid Helper
  PRZECZYTAJ TO NAJPIERW (README FIRST)
================================================================================

To jest prosty program na Windows. Pomaga po wyścigu w Project Motor Racing
przepisać wyniki do SimGrid (tabela + plik JSON), bez ręcznego przepisywania
z ekranu.

Działa TYLKO na komputerze, na którym grasz w PMR.
Nie wrzucaj tego na stronę internetową — nie zadziała.


--------------------------------------------------------------------------------
KROK 1 — Rozpakuj paczkę
--------------------------------------------------------------------------------

1. Zapisz plik ZIP na dysk (np. Pulpit albo Dokumenty).
2. Kliknij prawym przyciskiem → „Wyodrębnij wszystkie…” / „Extract”.
3. Otwórz folder, który się pojawił.


--------------------------------------------------------------------------------
KROK 2 — Zainstaluj Node.js (jednorazowo)
--------------------------------------------------------------------------------

Program potrzebuje darmowego „Node.js” (jak silnik do uruchomienia).

1. Wejdź na:  https://nodejs.org/
2. Pobierz wersję LTS (zielony przycisk).
3. Zainstaluj klikając Dalej / Next (zostaw domyślne opcje).
4. Po instalacji ZAMKNIJ i OTWÓRZ ponownie ten folder
   (albo zrestartuj komputer, jeśli coś nie działa).

Sprawdzenie: po instalacji w tym folderze kliknij dwukrotnie START.bat —
jeśli Node jest OK, otworzy się przeglądarka.


--------------------------------------------------------------------------------
KROK 3 — Ustaw UDP w grze Project Motor Racing
--------------------------------------------------------------------------------

To najważniejsze. Gra musi wysyłać dane na ten komputer.

1. Odpal PMR.
2. Wejdź w:  Settings → Preferences  (Ustawienia → Preferencje).
3. Znajdź opcje UDP i ustaw:

     UDP Enabled  =  On / Włączone
     UDP Host     =  127.0.0.1
     UDP Port     =  7580

4. Zapisz / zatwierdź i wróć do menu.

UWAGA:
• Port 7580 musi być taki sam w grze i w helperze.
• Jeśli używasz SimHub — na czas zbierania wyników WYŁĄCZ SimHub
  albo zmień port w obu miejscach na ten sam wolny numer
  (SimHub często zajmuje 7580).
• Unikaj portu 7576 (często zajmuje go oprogramowanie kierownicy).


--------------------------------------------------------------------------------
KROK 4 — Uruchom helper
--------------------------------------------------------------------------------

1. W rozpakowanym folderze kliknij dwukrotnie:  START.bat
2. Pojawi się czarne okienko — NIE ZAMYKAJ GO (to jest program w tle).
3. Otworzy się przeglądarka ze stroną:

     http://127.0.0.1:3847

4. Na górze powinien być pasek statusu:
   • żółty  = czeka na grę / pakiety
   • zielony = „Połączono z PMR” — działa
   • czerwony = problem z portem (zajęty albo zły numer)


--------------------------------------------------------------------------------
KROK 5 — Co robić podczas / po wyścigu
--------------------------------------------------------------------------------

A) LIVE + AUTOMATYCZNE CZĘŚCI WEEKENDU
   Helper sam rozpoznaje Trening / Kwalifikacje / Wyścig z gry.
   Gdy kończy się jedna część (albo gra przechodzi do następnej),
   wyniki zapisują się do osobnej tabeli nad „live”.
   Kliknij wiersz kierowcy w LIVE → czasy poszczególnych okrążeń.
   Najszybsze okrążenie jest zielone.

B) ZAPIS CSV (automatycznie)
   Po zakończeniu Treningu / Quali / Wyścigu plik ląduje w folderze:

        results\

   Nazwa pliku np.:  Quali_Daytona_21.09.2026.csv
   W UI przy zamkniętej części możesz też kliknąć link / „Pobierz CSV”.

C) PO WYŚCIGU — Stop UDP
   Kliknij „Stop UDP”, żeby ręcznie zamrozić bieżące live
   (zwykle nie trzeba — części weekendu zapisują się same).
   Potem możesz wrócić przyciskiem „Resume UDP”.

D) KARY (opcjonalnie)
   „Kary po wyścigu” → wpisz karę w sekundach przy kierowcy → „Zastosuj kary”.
   Kara dolicza się do czasu całkowitego (czerwony wiersz).
   Pozycji program NIE zmienia automatycznie — w SimGrid możesz to
   przestawić ręcznie przy wpisywaniu.

E) WYNIKI DO SIMGRID
   1. Kliknij „Wygeneruj wyniki do SimGrid”.
   2. Wgraj DWA pliki entrylisty (oba są potrzebne):
        • CSV z SimGrid (lista zgłoszeń / entrylist)
        • JSON entrylisty PMR (plik „for app” / entrylista z serwera)
   3. Kliknij „Wczytaj i pokaż tabelę”.
   4. Zobaczysz tabelę jak w formularzu Race Results SimGrid:
        POS | NAME | CLASS | # | CAR | LAPS | BEST LAP | TOTAL TIME | DNF | DNS
   5. „Kopiuj tabelę (TSV)” — wygodne do wklejenia np. do Excela / Notatnika.
   6. „Pobierz JSON” — plik do archiwum / dalszego użycia.

F) NOWA SESJA
   Przed kolejnym weekendem kliknij „Nowa sesja” i potwierdź.
   Czyści tabele w programie, kary i entrylistę.
   Pliki CSV w folderze results\ zostają na dysku.


--------------------------------------------------------------------------------
Gdzie co ustawiać W APLIKACJI (krótko)
--------------------------------------------------------------------------------

• Port UDP z gry
    Mały blok pod przyciskami.
    Wpisz ten sam numer co w PMR (domyślnie 7580) → „Zastosuj port”.
    „Sprawdź port” mówi, czy port jest wolny / zajęty.

• Stop UDP / Resume UDP
    Zamraża albo odblokowuje zbieranie wyników z gry.

• Kary po wyścigu
    Kary w sekundach po zakończeniu.

• Wygeneruj wyniki do SimGrid
    Upload entrylisty + tabela do przepisania / skopiowania.

• Nowa sesja
    Reset wszystkiego przed kolejnym wyścigiem.

• Klik w wiersz tabeli live
    Szczegóły okrążeń tego kierowcy.


--------------------------------------------------------------------------------
Gdy coś nie działa
--------------------------------------------------------------------------------

1. Zielony pasek się nie pojawia
   → Sprawdź UDP w PMR (Host 127.0.0.1, Port = jak w apce).
   → Zamknij SimHub i kliknij „Zastosuj port” jeszcze raz.
   → Uruchom najpierw START.bat, potem wejdź do sesji w grze.

2. START.bat pisze, że nie ma Node
   → Doinstaluj Node.js LTS z https://nodejs.org/ i uruchom START.bat ponownie.

3. „Port zajęty”
   → Zmień port w helperze I w PMR na ten sam inny numer (np. 7581).
   → Albo zamknij program, który trzyma stary port (często SimHub).

4. Czarne okienko się zamyka od razu
   → Przeczytaj komunikat błędu. Najczęściej brak Node albo zajęty port.


--------------------------------------------------------------------------------
Zamykanie
--------------------------------------------------------------------------------

Zamknij czarne okienko (krzyżyk) albo naciśnij Ctrl+C w tym okienku.
Zakładkę w przeglądarce możesz zamknąć osobno.


--------------------------------------------------------------------------------
Kontakt / uwagi
--------------------------------------------------------------------------------

Ta paczka jest do użytku lokalnego przez hosta / admina wyścigu.
Nie wymaga internetu do działania (poza jednorazowym pobraniem Node.js).

Powodzenia na starcie!
================================================================================
