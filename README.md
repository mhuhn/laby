# Laby

Klassisches Kugellabyrinth aus Holz als PWA fürs iPad: Die Metallkugel wird durch Neigen des Geräts gesteuert.

- 20 Level, von 4×3 Feldern mit einem Loch bis 10×7 Feldern mit fast 50 Löchern
- Leitlinie mit nummerierten Zwischenzielen; nach einem Fall wahlweise zurück zum letzten Zwischenziel oder zum Start
- Bestzeiten und freigeschaltete Level werden lokal gespeichert
- Immer im Querformat, läuft offline (Service Worker)
- Holzmaserung, Stahlkugel und Klänge werden im Browser berechnet – keine Bild- oder Tondateien
- Am Computer zum Testen mit den Pfeiltasten steuerbar

## Spielen

Über GitHub Pages öffnen, in Safari „Teilen → Zum Home-Bildschirm“ wählen und beim ersten Start den Zugriff auf „Bewegung & Ausrichtung“ erlauben.
Vor jedem Level gibt es einen kurzen Countdown: In dieser Zeit wird die aktuelle Haltung des iPads als „waagerecht“ übernommen.
Die Ausrichtungssperre im Kontrollzentrum verhindert, dass sich der Bildschirm beim Neigen dreht.

## Dateien

- `index.html`, `style.css`, `app.js` – das Spiel (ohne Abhängigkeiten)
- `manifest.webmanifest`, `sw.js`, `icons/` – PWA
