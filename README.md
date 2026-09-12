# Gewichtstracking (v1)

Schlanke, deutschsprachige Web-App zum Gewichtstracking – für Valentin im Cut.
Alles läuft lokal im Browser (kein Backend). Daten liegen in `localStorage` und können per JSON/CSV gesichert werden.

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

## Erste Schritte

1. Bei leerem Stand erscheint ein Hinweis: Baseline am **25.09.2026** eintragen.
2. Button „Baseline am 25.09.2026 eintragen“ öffnet das Formular (Datum/Uhrzeit vorausgefüllt, Baseline-Häkchen gesetzt).
3. Gewicht prüfen (Vorschlag ~72,0 kg) und speichern.
4. Täglich idealerweise **morgens nüchtern** nachwiegen – der **7-Tage-Schnitt** ist die Hauptkennzahl.

## Funktionen

- Gewicht mit einer Dezimalstelle + Datum/Uhrzeit
- Optional kurze Notiz, Phase (Cut / Aufbau), Baseline-Flag
- **7-Tage-Mittel** als Primärmetrik (keine Übertreibung einzelner Tage)
- Wochenrate (kg/Woche) aus dem gleitenden 7-Tage-Mittel
- Zielgewicht + Zieldatum (editierbar in den Einstellungen)
- Trend-Chart (Chart.js, CDN) – Tageswerte dezent, 7-Tage-Mittel hervorgehoben
- Wochen-Digest: Mittel, Δ zur Vorwoche, Abstand zum Ziel, Rate vs. Zielband
- Soft-Alert bei flachem/steigendem 7-Tage-Trend über ~10–14 Tage (ruhiger Hinweistext; aus bei Aufbau / letztem Eintrag Aufbau)
- Hinweis „noch unsicher“, wenn weniger als 4 Tage im 7-Tage-Fenster
- Button „Wochen-Digest kopieren“ (Plaintext für den Coach)
- Export CSV & JSON, Import JSON
- Einstellungen: Baseline, Ziel, Phasen-Default, Zielrate 0,35–0,5 kg/Wo, Größe/Alter optional

## Berechnungsregeln

**7-Tage-Mittel**  
Pro Kalendertag mit Einträgen wird der Tagesmittelwert gebildet. Danach Mittel über alle Tage *mit Daten* im Fenster der letzten 7 Kalendertage (inkl. Bezugsdatum). Angezeigt wird, wie viele Tage beigetragen haben.

**Wochenrate**  
`aktuelles 7-Tage-Mittel − 7-Tage-Mittel von vor ~7 Tagen` (kg/Woche). Negativ = Abnahme.

**Soft-Alert**  
Wenn über ca. 10–14 Tage der Trend des 7-Tage-Mittels flach oder steigend ist (≥ 0, mit kleiner Toleranz), erscheint ein ruhiger Hinweis: zuerst Salz/Wasser prüfen, ggf. −75–100 kcal.

## Defaults (editierbar)

| Einstellung        | Default                          |
|--------------------|----------------------------------|
| Baseline / Start   | 2026-09-25                       |
| Zielgewicht        | 65,5 kg (Bereich ca. 65–66)      |
| Zieldatum          | 2026-12-31                       |
| Phase              | Cut                              |
| Zielrate           | 0,35–0,5 kg/Woche Verlust        |
| Größe / Alter      | 177 cm / 38 (nur Anzeige/optional)|

## Technik

- Statisch: `index.html`, `app.js`, `styles.css`
- Persistenz: `localStorage` (Schlüssel `gewichtstracking_v1`)
- Chart: Chart.js 4.x per CDN
- Kein Backend, keine Accounts

## Nicht in v1

Umfangreiche Körpermaße, Körperfett %, Kalorien-Tracking, Fotos – bewusst weggelassen.

## Ton

Ruhig bleiben. +1–2 kg nach Restaurant oder Urlaub sind normal (Salz/Wasser). Der Trend über Tage zählt, nicht der einzelne Morgen.
