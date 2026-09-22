================================================================================
  PMR → SimGrid Helper
  README FIRST (read this before starting)
================================================================================

Windows helper for Project Motor Racing race admins.
It builds SimGrid-friendly results from live UDP telemetry (no SimHub).

It ONLY works on the PC that runs PMR.
Do not host this on a website / GitHub Pages — that will not receive game UDP.


--------------------------------------------------------------------------------
STEP 1 — Unzip
--------------------------------------------------------------------------------

1. Save the ZIP to your PC (Desktop or Documents).
2. Right-click → Extract All…
3. Open the extracted folder.


--------------------------------------------------------------------------------
STEP 2 — Install Node.js (once)
--------------------------------------------------------------------------------

1. Go to https://nodejs.org/
2. Download the LTS build (green button).
3. Install with default options.
4. Close and reopen this folder (or reboot if needed).

Check: double-click START.bat — if Node is OK, a browser window opens.


--------------------------------------------------------------------------------
STEP 3 — Enable UDP in Project Motor Racing
--------------------------------------------------------------------------------

1. Launch PMR.
2. Settings → Preferences
3. Set:

     UDP Enabled  =  On
     UDP Host     =  127.0.0.1
     UDP Port     =  7580

4. Save and return to the menu.

Notes:
• Port must match the helper (default 7580).
• If you use SimHub, close it while capturing results, or change the port
  in BOTH places (SimHub often holds 7580).
• Avoid 7576 (often used by wheel software).


--------------------------------------------------------------------------------
STEP 4 — Start the helper
--------------------------------------------------------------------------------

1. Double-click START.bat
2. Keep the black console window open.
3. Browser opens at http://127.0.0.1:3847
4. Status bar colours:
   • yellow  = waiting for packets
   • green   = Connected to PMR
   • red     = port problem


--------------------------------------------------------------------------------
STEP 5 — During / after the weekend
--------------------------------------------------------------------------------

A) LIVE + automatic segments
   Practice / Qualifying / Race are detected from the game.
   When a segment ends, it is saved as its own table above Live.
   Click a driver row to expand lap times (best lap highlighted).

B) CSV files
   After each segment a file is written to:

        results\

   Example name: Quali_Daytona_21.09.2026.csv
   You can also download it from the UI link on each saved card.

C) Stop UDP / Resume UDP
   Optional manual freeze of the live table.

D) Race penalties
   Only for the Race session. Enter seconds → Apply.
   Totals update; positions are NOT auto-resorted.

E) Generate SimGrid results
   Upload SimGrid CSV + PMR JSON entry lists → race form table.
   Copy TSV or download JSON.

F) New session
   Clears tables / penalties / entry list in the app.
   CSV files in results\ remain on disk.


--------------------------------------------------------------------------------
Troubleshooting
--------------------------------------------------------------------------------

1. No green banner
   → Check PMR UDP (127.0.0.1 + matching port)
   → Close SimHub and click Apply port again
   → Start START.bat before joining the session

2. START.bat says Node is missing
   → Install Node.js LTS, then run START.bat again

3. Port in use
   → Change port in helper AND PMR (e.g. 7581)
   → Or close the app holding the old port

4. Console closes immediately
   → Read the error text (usually missing Node or busy port)


--------------------------------------------------------------------------------
Disclaimer
--------------------------------------------------------------------------------

Unofficial community tool. Not affiliated with Straight4 Games or SimGrid.
Local use only on 127.0.0.1.

================================================================================
