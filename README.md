# Laby

Klassisches Kugellabyrinth aus Holz als PWA fürs iPad: Die Metallkugel wird durch Neigen des Geräts gesteuert.

- 20 Level, von 5×3 Feldern mit einem Loch bis 12×8 Feldern mit rund 70 Löchern
- Level 7 ist ein originalgetreu vermessenes klassisches Holzlabyrinth (Leisten, Löcher, Linie und Nummern vom Foto übernommen)
- Aufdruck wie beim Holzlabyrinth: kräftige Linie mit runden Bögen, Lochnummern, START mit Haken, ZIEL mit Pfeil
- Zwei Löcher pro Level, dann ist das Spiel vorbei
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
