export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

export function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function debounce(fn, delay = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

export function toCsvValue(v) {
  if (Array.isArray(v)) v = v.join(" | ");
  const s = String(v ?? "");
  if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(toCsvValue).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const MOIS_LABELS = [
  "Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre",
];

// Semaine ISO 8601 (lundi = premier jour, semaine 1 = celle qui contient le premier jeudi de l'annee).
export function isoWeekInfo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // lundi = 0
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // jeudi de cette semaine
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 86400000));
  return { year: target.getUTCFullYear(), week };
}

export function isoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

function fmtDDMM(d) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

// type: "annee" | "mois" | "semaine". Retourne la valeur de periode d'une date (ex. "2026", "2026-08", "2026-W36").
export function periodValue(dateStr, type) {
  if (!dateStr) return null;
  if (type === "annee") {
    const d = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(d.getTime())) return null;
    return String(d.getFullYear());
  }
  if (type === "mois") {
    const d = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (type === "semaine") {
    const info = isoWeekInfo(dateStr);
    if (!info) return null;
    return `${info.year}-W${String(info.week).padStart(2, "0")}`;
  }
  return null;
}

// Libelle lisible pour une valeur de periode (ex. "2026-08" -> "Aout 2026").
export function periodLabel(value) {
  const [type, raw] = value.split(":");
  if (type === "annee") return raw;
  if (type === "mois") {
    const [y, m] = raw.split("-");
    return `${MOIS_LABELS[parseInt(m, 10) - 1]} ${y}`;
  }
  if (type === "semaine") {
    const [y, w] = raw.split("-W");
    const monday = isoWeekStart(parseInt(y, 10), parseInt(w, 10));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return `Semaine ${parseInt(w, 10)} - ${y} (${fmtDDMM(monday)} au ${fmtDDMM(sunday)})`;
  }
  return raw;
}

export function showToast(message, duration = 2600) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, duration);
}
