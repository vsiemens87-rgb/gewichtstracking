/**
 * Gewichtstracking v1.1 – Valentin
 * Persistenz: localStorage. Kein Backend.
 *
 * 7-Tage-Mittel-Regel:
 *   Pro Kalendertag mit Einträgen → Tagesmittelwert.
 *   Dann Mittel über alle Tage mit Daten im Fenster der letzten 7 Kalendertage
 *   (inkl. heute). Anzeige der beitragenden Tage.
 *   Ereignistage bleiben im Mittel (werden nicht ausgeschlossen).
 *
 * Wochenrate:
 *   currentMean7 - pastMean7 (vor ~7 Tagen) als kg/Woche. Negativ = Verlust.
 *
 * Soft-Alert:
 *   Wenn über 10–14 Tage der 7-Tage-Mittel-Trend ≥ 0 (flach/steigend).
 *   Nach Ereignis-Tag für N Tage stumm (Settings, Default 5).
 *
 * Ereignis-Tag:
 *   Optional eventType + eventLabel am Eintrag; sichtbar in Verlauf + Chart.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "gewichtstracking_v1";
  const DEFAULT_SETTINGS = {
    baselineDate: "2026-09-25",
    goalDate: "2026-12-31",
    goalWeight: 65.5,
    defaultPhase: "Cut",
    rateMin: 0.35,
    rateMax: 0.5,
    heightCm: 177,
    ageYears: 38,
    eventMuteDays: 5,
  };

  const EVENT_TYPES = {
    Cheat: "Cheat",
    Restaurant: "Restaurant",
    Sonstiges: "Sonstiges Ereignis",
    custom: "Ereignis",
  };

  /** @typedef {{ id: string, weight: number, datetime: string, note: string, phase: string, baseline: boolean, eventType: string|null, eventLabel: string }} Entry */

  let state = {
    settings: { ...DEFAULT_SETTINGS },
    entries: /** @type {Entry[]} */ ([]),
  };

  let chart = null;

  // —— Storage ——

  function clampMuteDays(n) {
    const v = parseInt(n, 10);
    if (Number.isNaN(v)) return DEFAULT_SETTINGS.eventMuteDays;
    return Math.min(7, Math.max(3, v));
  }

  function normalizeEntry(e) {
    let eventType = e.eventType != null ? e.eventType : null;
    let eventLabel = typeof e.eventLabel === "string" ? e.eventLabel : "";
    // Migrate optional nested event object if present
    if (!eventType && e.event && typeof e.event === "object") {
      eventType = e.event.type || null;
      eventLabel = e.event.label || eventLabel;
    }
    if (eventType === "") eventType = null;
    if (eventType && !["Cheat", "Restaurant", "Sonstiges", "custom"].includes(eventType)) {
      eventType = "custom";
      if (!eventLabel) eventLabel = String(e.eventType || "");
    }
    return {
      id: e.id || uid(),
      weight: Number(e.weight),
      datetime: e.datetime,
      note: e.note || "",
      phase: e.phase === "Aufbau" ? "Aufbau" : "Cut",
      baseline: !!e.baseline,
      eventType,
      eventLabel: eventLabel || "",
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.settings) {
        state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        state.settings.eventMuteDays = clampMuteDays(state.settings.eventMuteDays);
      }
      if (Array.isArray(data.entries)) {
        state.entries = data.entries.map(normalizeEntry);
      }
    } catch (e) {
      console.warn("Laden fehlgeschlagen:", e);
    }
  }

  function save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ settings: state.settings, entries: state.entries, version: 1.1 })
    );
  }

  // —— Date helpers ——

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  /** Local YYYY-MM-DD from Date */
  function toDateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseDateKey(key) {
    const [y, m, day] = key.split("-").map(Number);
    return new Date(y, m - 1, day);
  }

  function addDays(date, days) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }

  function formatDeDate(dateOrKey) {
    const d = typeof dateOrKey === "string" ? parseDateKey(dateOrKey.slice(0, 10)) : dateOrKey;
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function formatDeDateTime(isoLocal) {
    // isoLocal like "2026-09-25T07:30"
    const [datePart, timePart] = isoLocal.split("T");
    const time = timePart ? timePart.slice(0, 5) : "";
    return `${formatDeDate(datePart)}${time ? ", " + time : ""}`;
  }

  function nowLocalDatetimeValue() {
    const d = new Date();
    return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function morningBaselineDatetime(dateKey) {
    return `${dateKey}T07:00`;
  }

  function fmtKg(n, digits = 1) {
    if (n == null || Number.isNaN(n)) return "—";
    return n.toLocaleString("de-DE", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtDelta(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + n.toLocaleString("de-DE", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  // —— Math ——

  /** Day key → mean weight for that calendar day */
  function dailyMeans(entries) {
    /** @type {Record<string, number[]>} */
    const byDay = {};
    for (const e of entries) {
      const key = e.datetime.slice(0, 10);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(e.weight);
    }
    /** @type {Record<string, number>} */
    const means = {};
    for (const [k, arr] of Object.entries(byDay)) {
      means[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    return means;
  }

  /**
   * 7-day mean ending on endDate (inclusive).
   * Averages available daily means in [endDate-6, endDate].
   * @returns {{ mean: number|null, days: number, windowStart: string, windowEnd: string }}
   */
  function mean7Ending(daily, endDate) {
    const end = typeof endDate === "string" ? parseDateKey(endDate) : endDate;
    const keys = [];
    for (let i = 6; i >= 0; i--) {
      keys.push(toDateKey(addDays(end, -i)));
    }
    const vals = keys.filter((k) => daily[k] != null).map((k) => daily[k]);
    if (vals.length === 0) {
      return {
        mean: null,
        days: 0,
        windowStart: keys[0],
        windowEnd: keys[6],
      };
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return {
      mean,
      days: vals.length,
      windowStart: keys[0],
      windowEnd: keys[6],
    };
  }

  /** Latest calendar day that has data, or today */
  function latestDataDay(daily) {
    const keys = Object.keys(daily).sort();
    if (keys.length === 0) return toDateKey(new Date());
    return keys[keys.length - 1];
  }

  function weeklyRate(daily, asOfDate) {
    const end = typeof asOfDate === "string" ? parseDateKey(asOfDate) : asOfDate;
    const current = mean7Ending(daily, end);
    const past = mean7Ending(daily, addDays(end, -7));
    if (current.mean == null || past.mean == null) {
      return { rate: null, current, past };
    }
    return {
      rate: current.mean - past.mean,
      current,
      past,
    };
  }

  /**
   * Soft-alert: look at 7-day means for each day in the last 14 days that we can compute,
   * and compare mean at start of window (~14 days ago / first available) to current.
   * If trend ≥ 0 over ≥10 days of observation → alert.
   */
  function softAlertInfo(daily) {
    const endKey = latestDataDay(daily);
    const end = parseDateKey(endKey);
    /** @type {{ key: string, mean: number }[]} */
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(end, -i);
      const m = mean7Ending(daily, d);
      if (m.mean != null && m.days >= 3) {
        series.push({ key: toDateKey(d), mean: m.mean });
      }
    }
    if (series.length < 10) {
      return { show: false, reason: "zu_wenig", series };
    }
    // Use first and last points spanning at least 10 calendar days
    const first = series[0];
    const last = series[series.length - 1];
    const spanDays =
      (parseDateKey(last.key) - parseDateKey(first.key)) / (1000 * 60 * 60 * 24);
    if (spanDays < 9) {
      return { show: false, reason: "span_kurz", series };
    }
    const delta = last.mean - first.mean;
    // Flat or up: delta >= -0.05 (tiny noise tolerance toward flat)
    const flatOrUp = delta >= -0.05;
    return {
      show: flatOrUp,
      delta,
      spanDays: Math.round(spanDays),
      first,
      last,
      series,
    };
  }


  function entryHasEvent(e) {
    return !!(e && e.eventType);
  }

  function eventDisplayLabel(e) {
    if (!e || !e.eventType) return "";
    if (e.eventType === "custom") {
      return (e.eventLabel && e.eventLabel.trim()) || "Ereignis";
    }
    if (e.eventType === "Sonstiges") {
      const extra = (e.eventLabel && e.eventLabel.trim()) || "";
      return extra ? "Sonstiges: " + extra : EVENT_TYPES.Sonstiges;
    }
    const base = EVENT_TYPES[e.eventType] || e.eventType;
    const extra = (e.eventLabel && e.eventLabel.trim()) || "";
    return extra ? base + ": " + extra : base;
  }

  /** Map dateKey → list of event labels that day */
  function eventsByDay(entries) {
    /** @type {Record<string, string[]>} */
    const map = {};
    for (const e of entries) {
      if (!entryHasEvent(e)) continue;
      const key = e.datetime.slice(0, 10);
      if (!map[key]) map[key] = [];
      const label = eventDisplayLabel(e);
      if (!map[key].includes(label)) map[key].push(label);
    }
    return map;
  }

  /**
   * Most recent event whose day is within mute window before asOf (latest data day).
   * Mute while daysSince < muteDays → Trend belastbar ab eventDay + muteDays.
   * @returns {{ entry: Entry, eventDay: string, reliableFrom: string, daysSince: number }|null}
   */
  function recentEventMuteInfo(entries, asOfKey, muteDays) {
    const asOf = parseDateKey(asOfKey);
    const n = clampMuteDays(muteDays);
    /** @type {{ entry: Entry, eventDay: string, reliableFrom: string, daysSince: number }|null} */
    let best = null;
    for (const e of entries) {
      if (!entryHasEvent(e)) continue;
      const eventDay = e.datetime.slice(0, 10);
      const daysSince =
        (asOf - parseDateKey(eventDay)) / (1000 * 60 * 60 * 24);
      if (daysSince < 0) continue; // future relative to asOf
      if (daysSince >= n) continue;
      const reliableFrom = toDateKey(addDays(parseDateKey(eventDay), n));
      const cand = { entry: e, eventDay, reliableFrom, daysSince };
      if (!best || eventDay > best.eventDay || (eventDay === best.eventDay && e.datetime > best.entry.datetime)) {
        best = cand;
      }
    }
    return best;
  }

  // —— UI helpers ——

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function sortedEntries() {
    return [...state.entries].sort((a, b) => b.datetime.localeCompare(a.datetime));
  }


  function buildDigestPlaintext() {
    const daily = dailyMeans(state.entries);
    if (Object.keys(daily).length === 0) return "";
    const asOf = latestDataDay(daily);
    const m7 = mean7Ending(daily, asOf);
    const wr = weeklyRate(daily, asOf);
    const s = state.settings;
    const dist = m7.mean != null ? m7.mean - s.goalWeight : null;
    const mute = recentEventMuteInfo(state.entries, asOf, s.eventMuteDays);
    const lines = [
      "Wochen-Digest Gewichtstracking",
      "Stand: " + formatDeDate(asOf),
      "Phase: " + s.defaultPhase,
      "7-Tage-Mittel: " + (m7.mean != null ? fmtKg(m7.mean) + " kg (" + m7.days + " Tage)" : "—"),
      "Δ vs. Vorwoche: " + (wr.rate != null ? fmtDelta(wr.rate) + " kg" : "—"),
      "Abstand zum Ziel (" + fmtKg(s.goalWeight) + " kg): " +
        (dist != null
          ? (dist > 0 ? fmtKg(dist) + " kg über Ziel" : dist < 0 ? fmtKg(Math.abs(dist)) + " kg unter Ziel" : "am Ziel")
          : "—"),
      "Wochenrate: " + (wr.rate != null ? fmtDelta(wr.rate) + " kg/Wo" : "—") +
        " (Zielband −" + fmtKg(s.rateMin, 2) + " bis −" + fmtKg(s.rateMax, 2) + " kg/Wo)",
    ];
    if (mute) {
      const evLabel = eventDisplayLabel(mute.entry);
      lines.push(
        "Ereignis am " + formatDeDate(mute.eventDay).slice(0, 6) +
          (evLabel ? " (" + evLabel + ")" : "") +
          " — Trend erst ab " + formatDeDate(mute.reliableFrom).slice(0, 6) + " wieder belastbar"
      );
    }
    return lines.join("\n");
  }

  async function copyWochenDigest() {
    const text = buildDigestPlaintext();
    if (!text) {
      toast("Noch keine Daten für den Digest");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Wochen-Digest kopiert");
    } catch (e) {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("Wochen-Digest kopiert");
    }
  }

  // —— Tabs ——

  function switchPanel(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      const active = t.dataset.panel === name;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".panel").forEach((p) => {
      const active = p.id === "panel-" + name;
      p.classList.toggle("active", active);
      p.hidden = !active;
    });
  }

  // —— Render ——

  function renderPhaseBadge() {
    const badge = $("phaseBadge");
    const phase = state.settings.defaultPhase;
    badge.textContent = phase;
    badge.classList.toggle("aufbau", phase === "Aufbau");
  }

  function renderDashboard() {
    const hasEntries = state.entries.length > 0;
    $("emptyState").hidden = hasEntries;
    $("dashboardContent").hidden = !hasEntries;

    if (!hasEntries) {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      return;
    }

    const daily = dailyMeans(state.entries);
    const asOf = latestDataDay(daily);
    const m7 = mean7Ending(daily, asOf);
    const wr = weeklyRate(daily, asOf);
    const s = state.settings;

    // Primary metric
    $("metricMean7").textContent = m7.mean != null ? fmtKg(m7.mean) + " kg" : "—";
    if (m7.days <= 0) {
      $("metricMean7Sub").textContent = "noch keine Daten im Fenster";
    } else if (m7.days < 4) {
      $("metricMean7Sub").textContent =
        `${m7.days} Tag${m7.days === 1 ? "" : "e"} im Fenster · noch unsicher – erst ab ~4 Tagen belastbar · Stand ${formatDeDate(asOf)}`;
    } else {
      $("metricMean7Sub").textContent =
        `${m7.days} Tag${m7.days === 1 ? "" : "e"} im Fenster · Stand ${formatDeDate(asOf)}`;
    }

    // Rate
    const rateEl = $("metricRate");
    if (wr.rate != null) {
      rateEl.textContent = fmtDelta(wr.rate) + " kg/Wo";
      rateEl.classList.toggle("loss", wr.rate < -0.05);
      rateEl.classList.toggle("gain", wr.rate > 0.05);
    } else {
      rateEl.textContent = "—";
      rateEl.classList.remove("loss", "gain");
    }
    $("metricRateSub").textContent = `Ziel: ${fmtKg(s.rateMin, 2)}–${fmtKg(s.rateMax, 2)} kg/Wo Verlust`;

    // Goal
    $("metricGoal").textContent = fmtKg(s.goalWeight) + " kg";
    const dist = m7.mean != null ? m7.mean - s.goalWeight : null;
    $("metricGoalSub").textContent =
      dist != null
        ? `noch ${fmtKg(Math.abs(dist))} kg · bis ${formatDeDate(s.goalDate)}`
        : `bis ${formatDeDate(s.goalDate)}`;

    // Last entry
    const last = sortedEntries()[0];
    $("metricLast").textContent = last ? fmtKg(last.weight) + " kg" : "—";
    $("metricLastSub").textContent = last
      ? formatDeDateTime(last.datetime) + " · Einzelwerte schwanken – normal"
      : "Einzelwerte schwanken – normal";

    // Digest
    $("digestMean").textContent = m7.mean != null ? fmtKg(m7.mean) + " kg" : "—";

    const deltaEl = $("digestDelta");
    if (wr.rate != null) {
      deltaEl.textContent = fmtDelta(wr.rate) + " kg";
      deltaEl.className = "d-value " + (wr.rate <= 0 ? "ok" : "warn");
    } else {
      deltaEl.textContent = "— (Vorwoche braucht Daten)";
      deltaEl.className = "d-value";
    }

    const distEl = $("digestDistance");
    if (dist != null) {
      distEl.textContent =
        dist > 0 ? fmtKg(dist) + " kg über Ziel" : dist < 0 ? fmtKg(Math.abs(dist)) + " kg unter Ziel" : "am Ziel";
    } else {
      distEl.textContent = "—";
    }

    const bandEl = $("digestRateBand");
    if (wr.rate != null) {
      // Loss is negative; target band is rateMin..rateMax loss → compare -rate
      const loss = -wr.rate;
      if (loss >= s.rateMin && loss <= s.rateMax) {
        bandEl.textContent = "im Zielband ✓";
        bandEl.className = "d-value ok";
      } else if (loss > s.rateMax) {
        bandEl.textContent = "schneller als Zielband";
        bandEl.className = "d-value warn";
      } else if (loss < 0) {
        bandEl.textContent = "steigend / nicht im Cut-Tempo";
        bandEl.className = "d-value warn";
      } else {
        bandEl.textContent = "langsamer als Zielband";
        bandEl.className = "d-value warn";
      }
    } else {
      bandEl.textContent = "—";
      bandEl.className = "d-value";
    }

    // Soft alert (nur Cut; nach Ereignis im Mute-Fenster stumm)
    const alert = softAlertInfo(daily);
    const alertBox = $("softAlert");
    const lastPhase = last ? last.phase : s.defaultPhase;
    const inCut = s.defaultPhase === "Cut" && lastPhase !== "Aufbau";
    const muteInfo = recentEventMuteInfo(state.entries, asOf, s.eventMuteDays);
    const mutedByEvent = !!muteInfo;
    if (alert.show && inCut && !mutedByEvent) {
      alertBox.hidden = false;
      $("softAlertText").textContent =
        "Dein 7-Tage-Mittel ist seit ca. " +
        (alert.spanDays || 10) +
        " Tagen flach oder leicht gestiegen. " +
        "Zuerst Salz und Wasser prüfen (Restaurant, Stress, wenig Schlaf) – das erklärt oft alles. " +
        "Wenn der Trend weiter stehen bleibt, kannst du ruhig etwa −75 bis −100 kcal anpassen. Kein Drama.";
    } else {
      alertBox.hidden = true;
    }

    // Digest: Ereignis-Hinweis
    const digestEventRow = $("digestEventRow");
    const digestEvent = $("digestEvent");
    if (muteInfo) {
      digestEventRow.hidden = false;
      const dd = formatDeDate(muteInfo.eventDay).slice(0, 6);
      const rd = formatDeDate(muteInfo.reliableFrom).slice(0, 6);
      digestEvent.textContent =
        "Ereignis am " + dd + " — Trend erst ab " + rd + " wieder belastbar";
      digestEvent.className = "d-value warn";
    } else {
      digestEventRow.hidden = true;
      digestEvent.textContent = "—";
      digestEvent.className = "d-value";
    }

    renderChart(daily);
  }

  function renderChart(daily) {
    const canvas = $("trendChart");
    if (!canvas || typeof Chart === "undefined") return;

    // Show from baseline or earliest entry, at least ~8 weeks lookback from latest
    const keys = Object.keys(daily).sort();
    if (keys.length === 0) return;

    const latest = parseDateKey(keys[keys.length - 1]);
    const earliest = parseDateKey(keys[0]);
    const eightWeeksAgo = addDays(latest, -56);
    const start = earliest < eightWeeksAgo ? earliest : eightWeeksAgo;
    // Prefer showing from baseline if set and within range
    const baseline = parseDateKey(state.settings.baselineDate);
    const chartStart = baseline <= latest && baseline >= addDays(latest, -90) ? baseline : start;

    const evMap = eventsByDay(state.entries);
    const labels = [];
    const dateKeys = [];
    const dailySeries = [];
    const mean7Series = [];
    const eventSeries = [];
    const pointRadius = [];
    const pointBg = [];
    const pointBorder = [];
    const pointBorderWidth = [];

    let d = chartStart;
    while (d <= latest) {
      const key = toDateKey(d);
      dateKeys.push(key);
      labels.push(formatDeDate(key));
      const dayVal = daily[key] != null ? Math.round(daily[key] * 10) / 10 : null;
      dailySeries.push(dayVal);
      const m = mean7Ending(daily, d);
      mean7Series.push(m.mean != null && m.days >= 2 ? Math.round(m.mean * 100) / 100 : null);
      const hasEv = !!evMap[key];
      eventSeries.push(hasEv && dayVal != null ? dayVal : null);
      if (hasEv && dayVal != null) {
        pointRadius.push(6);
        pointBg.push("rgba(212, 168, 91, 0.95)");
        pointBorder.push("#0f1419");
        pointBorderWidth.push(2);
      } else {
        pointRadius.push(3);
        pointBg.push("rgba(139, 154, 171, 0.55)");
        pointBorder.push("rgba(139, 154, 171, 0.45)");
        pointBorderWidth.push(1);
      }
      d = addDays(d, 1);
    }

    const goal = state.settings.goalWeight;

    const cfg = {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Tageswert",
            data: dailySeries,
            borderColor: "rgba(139, 154, 171, 0.45)",
            backgroundColor: "transparent",
            pointRadius,
            pointBackgroundColor: pointBg,
            pointBorderColor: pointBorder,
            pointBorderWidth,
            pointHoverRadius: 6,
            borderWidth: 1.5,
            tension: 0.2,
            spanGaps: false,
            order: 2,
          },
          {
            label: "Ereignis",
            data: eventSeries,
            borderColor: "transparent",
            backgroundColor: "rgba(212, 168, 91, 0.95)",
            pointRadius: 7,
            pointStyle: "triangle",
            pointHoverRadius: 9,
            pointBorderColor: "#0f1419",
            pointBorderWidth: 2,
            showLine: false,
            order: 0,
          },
          {
            label: "7-Tage-Mittel",
            data: mean7Series,
            borderColor: "#5b9fd4",
            backgroundColor: "rgba(91, 159, 212, 0.08)",
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.35,
            fill: false,
            spanGaps: true,
            order: 1,
          },
          {
            label: "Ziel",
            data: labels.map(() => goal),
            borderColor: "rgba(107, 191, 138, 0.55)",
            borderDash: [6, 4],
            pointRadius: 0,
            borderWidth: 1.5,
            fill: false,
            order: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: "#8b9aab",
              boxWidth: 12,
              font: { size: 11 },
              filter(item) {
                // Hide duplicate "Ereignis" if no events in view
                if (item.text === "Ereignis" && !eventSeries.some((v) => v != null)) return false;
                return true;
              },
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.parsed.y;
                if (v == null) return null;
                if (ctx.dataset.label === "Ereignis") {
                  const key = dateKeys[ctx.dataIndex];
                  const labs = (evMap[key] || []).join(", ");
                  return "Ereignis: " + labs + " (" + fmtKg(v) + " kg)";
                }
                return ctx.dataset.label + ": " + fmtKg(v) + " kg";
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#6b7c8f",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
              font: { size: 10 },
            },
            grid: { color: "rgba(45, 58, 74, 0.5)" },
          },
          y: {
            ticks: {
              color: "#6b7c8f",
              font: { size: 10 },
              callback(v) {
                return v + " kg";
              },
            },
            grid: { color: "rgba(45, 58, 74, 0.5)" },
          },
        },
      },
    };

    if (chart) {
      chart.data = cfg.data;
      chart.options = cfg.options;
      chart.update();
    } else {
      chart = new Chart(canvas, cfg);
    }
  }

  function renderHistory() {
    const list = $("entriesList");
    const empty = $("historyEmpty");
    const entries = sortedEntries();
    empty.hidden = entries.length > 0;
    list.innerHTML = "";

    for (const e of entries) {
      const li = document.createElement("li");
      li.className = "entry-item";

      const tags = [];
      if (e.baseline) tags.push('<span class="tag baseline">Baseline</span>');
      tags.push(
        `<span class="tag${e.phase === "Aufbau" ? " aufbau" : ""}">${escapeHtml(e.phase)}</span>`
      );
      if (entryHasEvent(e)) {
        tags.push(
          `<span class="tag event">${escapeHtml(eventDisplayLabel(e))}</span>`
        );
      }

      li.innerHTML = `
        <div>
          <div class="weight">${fmtKg(e.weight)} kg</div>
          <div class="meta">${formatDeDateTime(e.datetime)}</div>
          <div class="tags">${tags.join("")}</div>
          ${e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : ""}
        </div>
        <div class="entry-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-edit="${e.id}">Bearbeiten</button>
          <button type="button" class="btn btn-danger btn-sm" data-del="${e.id}">Löschen</button>
        </div>
      `;
      list.appendChild(li);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fillSettingsForm() {
    const s = state.settings;
    $("baselineDate").value = s.baselineDate;
    $("goalDate").value = s.goalDate;
    $("goalWeight").value = s.goalWeight;
    $("defaultPhase").value = s.defaultPhase;
    $("rateMin").value = s.rateMin;
    $("rateMax").value = s.rateMax;
    $("heightCm").value = s.heightCm ?? "";
    $("ageYears").value = s.ageYears ?? "";
    $("eventMuteDays").value = clampMuteDays(s.eventMuteDays);
  }

  function syncEventLabelField() {
    const type = $("eventTypeInput").value;
    const field = $("eventLabelField");
    const show = type === "custom" || type === "Sonstiges";
    field.hidden = !show;
    if (!show) {
      // keep label if switching away; cleared on form reset
    }
    const label = $("eventLabelInput");
    if (type === "custom") {
      label.required = true;
      label.placeholder = "z. B. Hochzeit, Urlaub …";
    } else {
      label.required = false;
      label.placeholder = "optional, z. B. Pizza-Abend";
    }
  }

  function fillEntryFormDefaults() {
    $("editId").value = "";
    $("weightInput").value = "";
    $("datetimeInput").value = nowLocalDatetimeValue();
    $("noteInput").value = "";
    $("phaseInput").value = state.settings.defaultPhase;
    $("baselineInput").checked = false;
    $("eventTypeInput").value = "";
    $("eventLabelInput").value = "";
    syncEventLabelField();
    $("saveEntryBtn").textContent = "Speichern";
    $("cancelEditBtn").hidden = true;
  }

  function renderAll() {
    renderPhaseBadge();
    renderDashboard();
    renderHistory();
    fillSettingsForm();
  }

  // —— CRUD ——

  function uid() {
    return "e_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function upsertEntry(entry) {
    const idx = state.entries.findIndex((x) => x.id === entry.id);
    if (idx >= 0) state.entries[idx] = entry;
    else state.entries.push(entry);
    save();
    renderAll();
  }

  function deleteEntry(id) {
    if (!confirm("Eintrag wirklich löschen?")) return;
    state.entries = state.entries.filter((e) => e.id !== id);
    save();
    renderAll();
    toast("Eintrag gelöscht");
  }

  function startEdit(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    switchPanel("log");
    $("editId").value = e.id;
    $("weightInput").value = e.weight;
    $("datetimeInput").value = e.datetime;
    $("noteInput").value = e.note || "";
    $("phaseInput").value = e.phase;
    $("baselineInput").checked = !!e.baseline;
    $("eventTypeInput").value = e.eventType || "";
    $("eventLabelInput").value = e.eventLabel || "";
    syncEventLabelField();
    $("saveEntryBtn").textContent = "Aktualisieren";
    $("cancelEditBtn").hidden = false;
  }

  // —— Export / Import ——

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    const payload = {
      version: 1.1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      entries: state.entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(`gewichtstracking_${toDateKey(new Date())}.json`, blob);
    toast("JSON exportiert");
  }

  function exportCsv() {
    const header = ["id", "datetime", "weight_kg", "note", "phase", "baseline", "eventType", "eventLabel"];
    const rows = sortedEntries().map((e) =>
      [
        e.id,
        e.datetime,
        e.weight.toFixed(1),
        `"${(e.note || "").replace(/"/g, '""')}"`,
        e.phase,
        e.baseline ? "1" : "0",
        e.eventType || "",
        `"${(e.eventLabel || "").replace(/"/g, '""')}"`,
      ].join(",")
    );
    const csv = "\uFEFF" + header.join(",") + "\n" + rows.join("\n");
    downloadBlob(`gewichtstracking_${toDateKey(new Date())}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
    toast("CSV exportiert");
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.entries)) {
          throw new Error("Ungültiges Format");
        }
        if (
          !confirm(
            "Import ersetzt alle aktuellen Einträge und Einstellungen. Fortfahren?"
          )
        ) {
          return;
        }
        state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        state.settings.eventMuteDays = clampMuteDays(state.settings.eventMuteDays);
        state.entries = data.entries.map(normalizeEntry);
        save();
        fillEntryFormDefaults();
        renderAll();
        toast("Import erfolgreich");
      } catch (err) {
        alert("Import fehlgeschlagen: " + (err.message || err));
      }
    };
    reader.readAsText(file);
  }

  // —— Events ——

  function bind() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => switchPanel(t.dataset.panel));
    });

    $("eventTypeInput").addEventListener("change", syncEventLabelField);

    const copyBtn = $("copyDigest");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        copyWochenDigest();
      });
    }

    $("ctaBaseline").addEventListener("click", () => {
      switchPanel("log");
      fillEntryFormDefaults();
      $("datetimeInput").value = morningBaselineDatetime(state.settings.baselineDate);
      $("baselineInput").checked = true;
      $("phaseInput").value = state.settings.defaultPhase;
      $("weightInput").value = "72.0";
      $("weightInput").focus();
      toast("Baseline-Datum vorausgefüllt – Gewicht prüfen und speichern");
    });

    $("entryForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const weight = parseFloat($("weightInput").value);
      if (Number.isNaN(weight)) return;
      let eventType = $("eventTypeInput").value || null;
      if (eventType === "") eventType = null;
      let eventLabel = ($("eventLabelInput").value || "").trim();
      if (eventType === "custom" && !eventLabel) {
        alert("Bitte ein Label für das eigene Ereignis eingeben.");
        return;
      }
      if (eventType !== "custom" && eventType !== "Sonstiges") {
        // optional free label only kept for Sonstiges/custom; still allow empty
      }
      const entry = {
        id: $("editId").value || uid(),
        weight: Math.round(weight * 10) / 10,
        datetime: $("datetimeInput").value,
        note: ($("noteInput").value || "").trim(),
        phase: $("phaseInput").value,
        baseline: $("baselineInput").checked,
        eventType,
        eventLabel: eventType ? eventLabel : "",
      };
      const wasEdit = !!$("editId").value;
      upsertEntry(entry);
      fillEntryFormDefaults();
      switchPanel("dashboard");
      toast(wasEdit ? "Eintrag aktualisiert" : "Eintrag gespeichert");
    });

    $("cancelEditBtn").addEventListener("click", () => {
      fillEntryFormDefaults();
    });

    $("entriesList").addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.dataset.edit) startEdit(t.dataset.edit);
      if (t.dataset.del) deleteEntry(t.dataset.del);
    });

    $("settingsForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const rateMin = parseFloat($("rateMin").value);
      const rateMax = parseFloat($("rateMax").value);
      if (rateMin > rateMax) {
        alert("Min-Rate darf nicht größer als Max-Rate sein.");
        return;
      }
      const muteRaw = parseInt($("eventMuteDays").value, 10);
      if (Number.isNaN(muteRaw) || muteRaw < 3 || muteRaw > 7) {
        alert("Soft-Alert-Stummschaltung: bitte 3–7 Tage wählen.");
        return;
      }
      state.settings = {
        baselineDate: $("baselineDate").value,
        goalDate: $("goalDate").value,
        goalWeight: parseFloat($("goalWeight").value),
        defaultPhase: $("defaultPhase").value,
        rateMin,
        rateMax,
        heightCm: $("heightCm").value ? parseInt($("heightCm").value, 10) : null,
        ageYears: $("ageYears").value ? parseInt($("ageYears").value, 10) : null,
        eventMuteDays: clampMuteDays(muteRaw),
      };
      save();
      renderAll();
      toast("Einstellungen gespeichert");
    });

    $("clearDataBtn").addEventListener("click", () => {
      if (!confirm("Wirklich ALLE Einträge und Einstellungen zurücksetzen?")) return;
      if (!confirm("Letzte Bestätigung: Daten unwiderruflich löschen?")) return;
      state = { settings: { ...DEFAULT_SETTINGS }, entries: [] };
      save();
      fillEntryFormDefaults();
      renderAll();
      toast("Alles zurückgesetzt");
    });

    $("exportJsonBtn").addEventListener("click", exportJson);
    $("exportCsvBtn").addEventListener("click", exportCsv);
    $("importJsonBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", () => {
      const f = $("importFile").files && $("importFile").files[0];
      if (f) importJson(f);
      $("importFile").value = "";
    });
  }

  // —— Init ——

  function init() {
    load();
    bind();
    fillEntryFormDefaults();
    // Sync phase select default
    $("phaseInput").value = state.settings.defaultPhase;
    renderAll();

    // Re-render chart after Chart.js may finish loading
    if (typeof Chart === "undefined") {
      const wait = setInterval(() => {
        if (typeof Chart !== "undefined") {
          clearInterval(wait);
          renderDashboard();
        }
      }, 50);
      setTimeout(() => clearInterval(wait), 5000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
