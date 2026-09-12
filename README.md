# Gewichtstracking (v1.1)

Schlanke, deutschsprachige Web-App zum Gewichtstracking – für Valentin im Cut.
Alles läuft lokal im Browser (kein Backend). Daten liegen in `localStorage` und können per JSON/CSV gesichert werden.

**Live:** https://vsiemens87-rgb.github.io/gewichtstracking/

## Öffnen

**Variante A – Datei direkt öffnen**

1. Ordner `gewichtstracking` öffnen
2. `index.html` im Browser öffnen (Doppelklick oder Rechtsklick → Öffnen mit …)

**Variante B – lokaler Server (empfohlen)**

```bash
cd gewichtstracking
python3 -m http.server 8080
```

Dann im Browser: [http://localhost:8080](http://localhost:8080)

**Variante C – Single-File**

`Gewichtstracking-standalone.html` (CSS+JS inline) bzw. `/workspace/Gewichtstracking.html` – zum Offline-Öffnen ohne Server.

## Erste Schritte

1. Bei leerem Stand erscheint ein Hinweis: Baseline am **25.09.2026** eintragen.
2. Button „Baseline am 25.09.2026 eintragen“ öffnet das Formular (Datum/Uhrzeit vorausgefüllt, Baseline-Häkchen gesetzt).
3. Gewicht prüfen (Vorschlag ~72,0 kg) und speichern.
4. Täglich idealerweise **morgens nüchtern** nachwiegen – der **7-Tage-Schnitt** ist die Hauptkennzahl.

## Funktionen

- Gewicht mit einer Dezimalstelle + Datum/Uhrzeit
- Optional kurze Notiz, Phase (Cut / Aufbau), Baseline-Flag
- **Ereignis-Tag (v1.1):** optional Cheat / Restaurant / Sonstiges Ereignis / eigenes Label
  - sichtbar im Verlauf und als Markierung im Chart
  - **Ereignistage bleiben im 7-Tage-Mittel** (werden nicht herausgerechnet)
- **7-Tage-Mittel** als Primärmetrik (keine Übertreibung einzelner Tage)
- Wochenrate (kg/Woche) aus dem gleitenden 7-Tage-Mittel
- Zielgewicht + Zieldatum (editierbar in den Einstellungen)
- Trend-Chart (Chart.js, CDN) – Tageswerte dezent, 7-Tage-Mittel hervorgehoben, Ereignisse markiert
- Wochen-Digest: Mittel, Δ zur Vorwoche, Abstand zum Ziel, Rate vs. Zielband
  - bei recentem Ereignis: „Ereignis am TT.MM. — Trend erst ab TT.MM. wieder belastbar“
- Soft-Alert bei flachem/steigendem 7-Tage-Trend über ~10–14 Tage (ruhiger Hinweistext; aus bei Aufbau / letztem Eintrag Aufbau)
  - **nach Ereignis für N Tage stumm** (Einstellungen 3–7, Standard 5)
- Hinweis „noch unsicher“, wenn weniger als 4 Tage im 7-Tage-Fenster
- Button „Wochen-Digest kopieren“ (Plaintext für den Coach)
- Export CSV & JSON, Import JSON (alte Einträge ohne Ereignisfelder werden migriert)
- Einstellungen: Baseline, Ziel, Phasen-Default, Zielrate 0,35–0,5 kg/Wo, Soft-Alert-Mute-Tage, Größe/Alter optional

## Berechnungsregeln

**7-Tage-Mittel**  
Pro Kalendertag mit Einträgen wird der Tagesmittelwert gebildet. Danach Mittel über alle Tage *mit Daten* im Fenster der letzten 7 Kalendertage (inkl. Bezugsdatum). Angezeigt wird, wie viele Tage beigetragen haben. **Ereignistage fließen ein.**

**Wochenrate**  
`aktuelles 7-Tage-Mittel − 7-Tage-Mittel von vor ~7 Tagen` (kg/Woche). Negativ = Abnahme.

**Soft-Alert**  
Wenn über ca. 10–14 Tage der Trend des 7-Tage-Mittels flach oder steigend ist (≥ 0, mit kleiner Toleranz), erscheint ein ruhiger Hinweis: zuerst Salz/Wasser prüfen, ggf. −75–100 kcal.  
Liegt ein Ereignis-Tag innerhalb der Mute-Fenster-Tage vor dem aktuellen Stand, wird der Soft-Alert unterdrückt. Trend gilt erst ab `Ereignistag + Mute-Tage` wieder als belastbar.

## Defaults (editierbar)

| Einstellung        | Default                          |
|--------------------|----------------------------------|
| Baseline / Start   | 2026-09-25                       |
| Zielgewicht        | 65,5 kg (Bereich ca. 65–66)      |
| Zieldatum          | 2026-12-31                       |
| Phase              | Cut                              |
| Zielrate           | 0,35–0,5 kg/Woche Verlust        |
| Soft-Alert Mute    | 5 Tage (3–7)                     |
| Größe / Alter      | 177 cm / 38 (nur Anzeige/optional)|

## Technik

- Statisch: `index.html`, `app.js`, `styles.css`
- Persistenz: `localStorage` (Schlüssel `gewichtstracking_v1`)
- Eintrag-Felder Ereignis: `eventType` (`null` | `Cheat` | `Restaurant` | `Sonstiges` | `custom`) + `eventLabel` (optional)
- Chart: Chart.js 4.x per CDN
- Kein Backend, keine Accounts

## Nicht in v1 / v1.1

Umfangreiche Körpermaße, Körperfett %, Kalorien-Tracking, Fotos – bewusst weggelassen.

## Ton

Ruhig bleiben. +1–2 kg nach Restaurant oder Urlaub sind normal (Salz/Wasser). Der Trend über Tage zählt, nicht der einzelne Morgen.
