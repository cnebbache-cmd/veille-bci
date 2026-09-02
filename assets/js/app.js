import {
  DATA_URL, TYPE_ACTE_LABELS, DOMAINES, DOMAINE_LABELS, PERIMETRES,
  PRIORITE_LABELS, PRIORITE_ORDER, STATUT_LABELS,
} from "./constants.js";
import {
  escapeHtml, formatDate, formatDateLong, daysUntil, normalize,
  debounce, downloadCsv, showToast, periodValue, periodLabel,
} from "./utils.js";

const APP = document.getElementById("app");
const NAV = document.getElementById("main-nav");
const SEARCH = document.getElementById("global-search");
const ECHEANCE_WINDOW_DAYS = 90;

let ITEMS = [];
let DATA_META = {};
let LOAD_ERROR = null;

// ------------------------------------------------------------------
// Chargement des donnees
// ------------------------------------------------------------------

async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    ITEMS = Array.isArray(json.elements) ? json.elements : [];
    DATA_META = json.meta || {};
  } catch (err) {
    LOAD_ERROR = err;
    ITEMS = [];
  }
}

// ------------------------------------------------------------------
// Routeur (hash-based, sans dependance)
// ------------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, queryStr] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(queryStr || "") };
}

function navigate(path, params) {
  const qs = params ? `?${params.toString()}` : "";
  location.hash = `${path}${qs}`;
}

function setActiveNav(path) {
  NAV.querySelectorAll("a[data-route]").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === path || (a.dataset.route === "/liste" && path.startsWith("/liste")));
  });
}

async function router() {
  const { path, params } = parseHash();
  setActiveNav(path);
  window.scrollTo(0, 0);

  if (LOAD_ERROR) {
    renderLoadError();
    return;
  }

  if (path === "/") {
    renderDashboard();
  } else if (path === "/liste") {
    renderListe(params);
  } else if (path === "/echeances") {
    renderEcheances();
  } else if (path.startsWith("/item/")) {
    const id = decodeURIComponent(path.slice("/item/".length));
    renderDetail(id);
  } else {
    render404();
  }
}

window.addEventListener("hashchange", router);

// ------------------------------------------------------------------
// Composants reutilisables
// ------------------------------------------------------------------

function disclaimerBanner() {
  return `<div class="disclaimer-banner">
    <span class="icon">&#9888;</span>
    <div>
      Les rubriques "resume", "explication detaillee" et "analyse d'impact" sont des documents de travail
      internes destines a faciliter la lecture ; elles n'ont pas valeur officielle. Se referer systematiquement
      au <strong>lien source officiel</strong> de chaque element avant toute decision ou action de conformite.
      ${DATA_META.avertissement ? `<br><em>${escapeHtml(DATA_META.avertissement)}</em>` : ""}
    </div>
  </div>`;
}

function badgePriorite(p) {
  if (!p) return "";
  return `<span class="badge badge-priorite-${p}">${PRIORITE_LABELS[p] || p}</span>`;
}

function badgeStatut(s) {
  if (!s) return "";
  return `<span class="badge badge-statut-${s}">${STATUT_LABELS[s] || s}</span>`;
}

function badgeAutorite(a) {
  if (!a) return "";
  return `<span class="badge badge-autorite">${escapeHtml(a)}</span>`;
}

function badgeFictif(item) {
  return item.donnee_fictive
    ? `<span class="badge badge-fictif" title="Exemple de demonstration, ne pas utiliser en production">Exemple fictif</span>`
    : "";
}

function badgeResume(item) {
  return item.resume_valide
    ? `<span class="badge badge-resume valide" title="Contenu relu et valide par la conformite">Resume valide</span>`
    : `<span class="badge badge-resume non-valide" title="Genere automatiquement, a valider par la conformite">Resume genere - a valider</span>`;
}

function itemRow(item) {
  const domaines = (item.domaines || []).map((d) => DOMAINE_LABELS[d] || d).join(", ");
  const echeance = item.date_echeance
    ? `<span class="echeance-badge">Echeance : ${formatDate(item.date_echeance)}</span>`
    : "";
  return `<a class="item-row" href="#/item/${encodeURIComponent(item.id)}">
    <div class="item-row-top">
      ${badgeAutorite(item.autorite)}
      ${badgePriorite(item.priorite)}
      ${badgeStatut(item.statut)}
      ${badgeFictif(item)}
      ${echeance}
    </div>
    <div class="item-title">${escapeHtml(item.titre)}</div>
    <div class="item-meta">
      <span>${TYPE_ACTE_LABELS[item.type_acte] || item.type_acte || ""}</span>
      <span>&middot; Publie le ${formatDate(item.date_publication)}</span>
      ${domaines ? `<span>&middot; ${escapeHtml(domaines)}</span>` : ""}
    </div>
    <div class="item-summary">${escapeHtml(item.resume_court || "")}</div>
  </a>`;
}

function render404() {
  APP.innerHTML = `<div class="empty-state"><h2>Page introuvable</h2>
    <p><a href="#/">Retour au tableau de bord</a></p></div>`;
}

function renderLoadError() {
  APP.innerHTML = `<div class="empty-state">
    <h2>Donnees indisponibles</h2>
    <p>Le fichier <code>veille.json</code> n'a pas pu etre charge (${escapeHtml(String(LOAD_ERROR?.message || LOAD_ERROR))}).</p>
    <p>Verifiez qu'il est present a la racine du site et servi en HTTPS ou via un serveur local (le chargement direct
    d'un fichier local par <code>file://</code> est bloque par le navigateur : utilisez un serveur local ou GitHub Pages).</p>
  </div>`;
}

// ------------------------------------------------------------------
// Vue : tableau de bord
// ------------------------------------------------------------------

function renderDashboard() {
  const counts = { eleve: 0, moyen: 0, faible: 0 };
  ITEMS.forEach((it) => { if (counts[it.priorite] !== undefined) counts[it.priorite]++; });

  const derniers = [...ITEMS]
    .sort((a, b) => (b.date_ajout || "").localeCompare(a.date_ajout || ""))
    .slice(0, 6);

  const echeances = ITEMS
    .filter((it) => it.date_echeance && daysUntil(it.date_echeance) !== null && daysUntil(it.date_echeance) <= ECHEANCE_WINDOW_DAYS && daysUntil(it.date_echeance) >= 0)
    .sort((a, b) => a.date_echeance.localeCompare(b.date_echeance));

  const nonTraites = ITEMS.filter((it) => it.statut === "a_analyser" || it.statut === "en_cours").length;

  APP.innerHTML = `
    <div class="page-title">
      <h1>Tableau de bord</h1>
      <span class="page-sub">${ITEMS.length} element(s) de veille &middot; ${nonTraites} en attente d'analyse ou en cours</span>
    </div>
    ${disclaimerBanner()}
    <div class="stat-grid">
      <div class="stat-card priorite-eleve" data-goto="eleve">
        <div class="stat-value">${counts.eleve}</div>
        <div class="stat-label">Priorite elevee</div>
      </div>
      <div class="stat-card priorite-moyen" data-goto="moyen">
        <div class="stat-value">${counts.moyen}</div>
        <div class="stat-label">Priorite moyenne</div>
      </div>
      <div class="stat-card priorite-faible" data-goto="faible">
        <div class="stat-value">${counts.faible}</div>
        <div class="stat-label">Priorite faible</div>
      </div>
      <div class="stat-card" data-goto="">
        <div class="stat-value">${ITEMS.length}</div>
        <div class="stat-label">Total du perimetre</div>
      </div>
    </div>

    <div class="two-col">
      <div class="section-block">
        <h2>Derniers elements ajoutes</h2>
        ${derniers.length ? derniers.map(itemRow).join("") : `<div class="empty-state">Aucun element pour le moment.</div>`}
      </div>
      <div class="section-block">
        <h2>Echeances dans les ${ECHEANCE_WINDOW_DAYS} prochains jours</h2>
        ${echeances.length ? echeances.map((it) => `
          <a class="item-row" href="#/item/${encodeURIComponent(it.id)}">
            <div class="item-row-top">
              <span class="echeance-badge">${formatDate(it.date_echeance)} &middot; J-${daysUntil(it.date_echeance)}</span>
              ${badgePriorite(it.priorite)}
            </div>
            <div class="item-title">${escapeHtml(it.titre)}</div>
            <div class="item-meta"><span>${escapeHtml(it.autorite || "")}</span></div>
          </a>`).join("") : `<div class="empty-state">Aucune echeance dans cette fenetre.</div>`}
      </div>
    </div>
  `;

  APP.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => {
      const p = new URLSearchParams();
      if (el.dataset.goto) p.set("priorite", el.dataset.goto);
      navigate("/liste", p);
    });
  });
}

// ------------------------------------------------------------------
// Vue : liste filtrable
// ------------------------------------------------------------------

const SORT_OPTIONS = {
  date_desc: { label: "Date de publication (recent -> ancien)", cmp: (a, b) => (b.date_publication || "").localeCompare(a.date_publication || "") },
  date_asc: { label: "Date de publication (ancien -> recent)", cmp: (a, b) => (a.date_publication || "").localeCompare(b.date_publication || "") },
  priorite: { label: "Priorite (elevee d'abord)", cmp: (a, b) => (PRIORITE_ORDER[a.priorite] ?? 9) - (PRIORITE_ORDER[b.priorite] ?? 9) },
  echeance: { label: "Echeance (proche d'abord)", cmp: (a, b) => (a.date_echeance || "9999") .localeCompare(b.date_echeance || "9999") },
};

function multiSelectValues(select) {
  return Array.from(select.selectedOptions).map((o) => o.value).filter(Boolean);
}

function applyFilters(items, f) {
  return items.filter((it) => {
    if (f.domaines.length && !(it.domaines || []).some((d) => f.domaines.includes(d))) return false;
    if (f.autorites.length && !f.autorites.includes(it.autorite)) return false;
    if (f.perimetres.length && !(it.perimetre || []).some((p) => f.perimetres.includes(p))) return false;
    if (f.priorite && it.priorite !== f.priorite) return false;
    if (f.statut && it.statut !== f.statut) return false;
    if (f.periode) {
      const [type, valeur] = f.periode.split(":");
      if (periodValue(it.date_publication, type) !== valeur) return false;
    }
    if (f.search) {
      const blob = normalize(`${it.titre} ${it.resume_court} ${it.explication_detaillee}`);
      if (!blob.includes(normalize(f.search))) return false;
    }
    return true;
  });
}

function filtersFromParams(params) {
  return {
    domaines: params.getAll("domaine"),
    autorites: params.getAll("autorite"),
    perimetres: params.getAll("perimetre"),
    priorite: params.get("priorite") || "",
    statut: params.get("statut") || "",
    periode: params.get("periode") || "",
    search: params.get("q") || "",
    sort: params.get("tri") || "date_desc",
  };
}

function paramsFromFilters(f) {
  const p = new URLSearchParams();
  f.domaines.forEach((d) => p.append("domaine", d));
  f.autorites.forEach((a) => p.append("autorite", a));
  f.perimetres.forEach((pe) => p.append("perimetre", pe));
  if (f.priorite) p.set("priorite", f.priorite);
  if (f.statut) p.set("statut", f.statut);
  if (f.periode) p.set("periode", f.periode);
  if (f.search) p.set("q", f.search);
  if (f.sort && f.sort !== "date_desc") p.set("tri", f.sort);
  return p;
}

// Construit les options du filtre periode (annees, mois, semaines presents dans les donnees),
// les plus recentes en tete.
function periodeOptions() {
  const annees = new Set(), mois = new Set(), semaines = new Set();
  ITEMS.forEach((it) => {
    if (!it.date_publication) return;
    annees.add(periodValue(it.date_publication, "annee"));
    mois.add(periodValue(it.date_publication, "mois"));
    semaines.add(periodValue(it.date_publication, "semaine"));
  });
  const sortDesc = (s) => [...s].filter(Boolean).sort().reverse();
  return { annees: sortDesc(annees), mois: sortDesc(mois), semaines: sortDesc(semaines) };
}

const AUTORITES_PRESENTES = () => [...new Set(ITEMS.map((i) => i.autorite).filter(Boolean))].sort();

function renderListe(params) {
  const f = filtersFromParams(params);
  const filtered = applyFilters(ITEMS, f).sort(SORT_OPTIONS[f.sort]?.cmp || SORT_OPTIONS.date_desc.cmp);
  const po = periodeOptions();
  const periodeOptionHtml = (type, values) => values.map((v) => {
    const val = `${type}:${v}`;
    return `<option value="${val}" ${f.periode === val ? "selected" : ""}>${escapeHtml(periodLabel(val))}</option>`;
  }).join("");

  APP.innerHTML = `
    <div class="page-title">
      <h1>Liste des elements de veille</h1>
    </div>
    ${disclaimerBanner()}
    <div class="filters-bar">
      <div class="filter-group" style="min-width:180px;">
        <label for="f-search">Recherche</label>
        <input type="search" id="f-search" placeholder="Titre, resume, explication..." value="${escapeHtml(f.search)}">
      </div>
      <div class="filter-group">
        <label for="f-domaine">Domaine</label>
        <select id="f-domaine" multiple size="4">
          ${DOMAINES.map((d) => `<option value="${d}" ${f.domaines.includes(d) ? "selected" : ""}>${escapeHtml(DOMAINE_LABELS[d] || d)}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="f-autorite">Autorite / source</label>
        <select id="f-autorite" multiple size="4">
          ${AUTORITES_PRESENTES().map((a) => `<option value="${a}" ${f.autorites.includes(a) ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="f-perimetre">Perimetre</label>
        <select id="f-perimetre" multiple size="4">
          ${PERIMETRES.map((p) => `<option value="${p}" ${f.perimetres.includes(p) ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="f-priorite">Priorite</label>
        <select id="f-priorite">
          <option value="">Toutes</option>
          ${Object.entries(PRIORITE_LABELS).map(([k, v]) => `<option value="${k}" ${f.priorite === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="f-statut">Statut</label>
        <select id="f-statut">
          <option value="">Tous</option>
          ${Object.entries(STATUT_LABELS).map(([k, v]) => `<option value="${k}" ${f.statut === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="f-periode">Periode (date de publication)</label>
        <select id="f-periode">
          <option value="">Toutes les periodes</option>
          ${po.annees.length ? `<optgroup label="Annee">${periodeOptionHtml("annee", po.annees)}</optgroup>` : ""}
          ${po.mois.length ? `<optgroup label="Mois">${periodeOptionHtml("mois", po.mois)}</optgroup>` : ""}
          ${po.semaines.length ? `<optgroup label="Semaine">${periodeOptionHtml("semaine", po.semaines)}</optgroup>` : ""}
        </select>
      </div>
      <div class="filter-group">
        <label for="f-tri">Trier par</label>
        <select id="f-tri">
          ${Object.entries(SORT_OPTIONS).map(([k, v]) => `<option value="${k}" ${f.sort === k ? "selected" : ""}>${v.label}</option>`).join("")}
        </select>
      </div>
      <div class="filters-actions">
        <button class="btn-link" id="f-reset" type="button">Reinitialiser</button>
        <button class="btn btn-secondary" id="f-export" type="button">Exporter CSV</button>
        <button class="btn btn-secondary" id="f-print" type="button">Imprimer / PDF</button>
      </div>
    </div>
    <div class="results-count">${filtered.length} resultat(s) sur ${ITEMS.length}</div>
    <div id="results-list">
      ${filtered.length ? filtered.map(itemRow).join("") : `<div class="empty-state">Aucun element ne correspond a ces filtres.</div>`}
    </div>
  `;

  const searchInput = document.getElementById("f-search");
  const applyFromUi = () => {
    const nf = {
      domaines: multiSelectValues(document.getElementById("f-domaine")),
      autorites: multiSelectValues(document.getElementById("f-autorite")),
      perimetres: multiSelectValues(document.getElementById("f-perimetre")),
      priorite: document.getElementById("f-priorite").value,
      statut: document.getElementById("f-statut").value,
      periode: document.getElementById("f-periode").value,
      search: searchInput.value.trim(),
      sort: document.getElementById("f-tri").value,
    };
    navigate("/liste", paramsFromFilters(nf));
  };

  document.getElementById("f-domaine").addEventListener("change", applyFromUi);
  document.getElementById("f-autorite").addEventListener("change", applyFromUi);
  document.getElementById("f-perimetre").addEventListener("change", applyFromUi);
  document.getElementById("f-priorite").addEventListener("change", applyFromUi);
  document.getElementById("f-statut").addEventListener("change", applyFromUi);
  document.getElementById("f-periode").addEventListener("change", applyFromUi);
  document.getElementById("f-tri").addEventListener("change", applyFromUi);
  searchInput.addEventListener("input", debounce(applyFromUi, 300));

  document.getElementById("f-reset").addEventListener("click", () => navigate("/liste"));
  document.getElementById("f-print").addEventListener("click", () => window.print());
  document.getElementById("f-export").addEventListener("click", () => {
    const header = [
      "id", "titre", "date_publication", "autorite", "type_acte", "domaines", "perimetre",
      "priorite", "statut", "date_echeance", "resume_court", "lien_source", "resume_valide",
    ];
    const rows = [header, ...filtered.map((it) => [
      it.id, it.titre, it.date_publication, it.autorite, TYPE_ACTE_LABELS[it.type_acte] || it.type_acte,
      it.domaines, it.perimetre, PRIORITE_LABELS[it.priorite] || it.priorite,
      STATUT_LABELS[it.statut] || it.statut, it.date_echeance, it.resume_court, it.lien_source,
      it.resume_valide ? "valide" : "a valider",
    ])];
    downloadCsv(`veille-bci-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    showToast(`Export CSV genere (${filtered.length} element(s)).`);
  });

  SEARCH.value = f.search;
}

// ------------------------------------------------------------------
// Vue : frise chronologique des echeances
// ------------------------------------------------------------------

function renderEcheances() {
  const withEcheance = ITEMS
    .filter((it) => it.date_echeance)
    .sort((a, b) => a.date_echeance.localeCompare(b.date_echeance));

  let currentMonth = "";
  const rows = [];
  for (const it of withEcheance) {
    const d = new Date(it.date_echeance + "T00:00:00");
    const monthLabel = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    if (monthLabel !== currentMonth) {
      currentMonth = monthLabel;
      rows.push(`<div class="timeline-month">${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)}</div>`);
    }
    const j = daysUntil(it.date_echeance);
    const passe = j !== null && j < 0;
    rows.push(`<div class="timeline-item">
      <a class="item-row" href="#/item/${encodeURIComponent(it.id)}">
        <div class="item-row-top">
          <span class="echeance-badge">${formatDate(it.date_echeance)}${passe ? " (echue)" : ` &middot; J-${j}`}</span>
          ${badgePriorite(it.priorite)}
          ${badgeStatut(it.statut)}
        </div>
        <div class="item-title">${escapeHtml(it.titre)}</div>
        <div class="item-meta"><span>${escapeHtml(it.autorite || "")}</span></div>
      </a>
    </div>`);
  }

  APP.innerHTML = `
    <div class="page-title"><h1>Frise des echeances</h1>
      <span class="page-sub">${withEcheance.length} element(s) avec une date d'entree en application ou une echeance</span>
    </div>
    ${disclaimerBanner()}
    <div class="timeline">
      ${rows.length ? rows.join("") : `<div class="empty-state">Aucune echeance enregistree.</div>`}
    </div>
  `;
}

// ------------------------------------------------------------------
// Vue : detail
// ------------------------------------------------------------------

function renderDetail(id) {
  const item = ITEMS.find((it) => it.id === id);
  if (!item) {
    APP.innerHTML = `<div class="empty-state"><h2>Element introuvable</h2>
      <p><a href="#/liste">Retour a la liste</a></p></div>`;
    return;
  }

  const domaines = (item.domaines || []).map((d) => DOMAINE_LABELS[d] || d);
  const perimetre = item.perimetre || [];
  let sourceHost = "";
  try { sourceHost = new URL(item.lien_source).hostname; } catch (e) { sourceHost = item.lien_source || ""; }

  APP.innerHTML = `
    <div class="detail-header">
      <a class="back-link" href="#/liste">&#8592; Retour a la liste</a>
      <div class="detail-badges">
        ${badgeAutorite(item.autorite)}
        ${badgePriorite(item.priorite)}
        ${badgeStatut(item.statut)}
        ${badgeResume(item)}
        ${badgeFictif(item)}
      </div>
      <h1 class="detail-title">${escapeHtml(item.titre)}</h1>
      <div class="detail-meta">
        <span>${TYPE_ACTE_LABELS[item.type_acte] || item.type_acte || ""}</span>
        <span>&middot; Publie le ${formatDateLong(item.date_publication)}</span>
        ${item.date_echeance ? `<span>&middot; Echeance : ${formatDateLong(item.date_echeance)}</span>` : ""}
        ${domaines.length ? `<span>&middot; ${escapeHtml(domaines.join(", "))}</span>` : ""}
        ${perimetre.length ? `<span>&middot; Perimetre : ${escapeHtml(perimetre.join(", "))}</span>` : ""}
      </div>
    </div>

    <div class="detail-grid">
      <div>
        <div class="detail-section">
          <h3>Resume court</h3>
          <p>${escapeHtml(item.resume_court || "Non renseigne.")}</p>
        </div>
        <div class="detail-section">
          <h3>Explication detaillee</h3>
          <p>${escapeHtml(item.explication_detaillee || "Non renseignee.")}</p>
        </div>
        <div class="detail-section impact">
          <h3>Analyse d'impact pour BCI</h3>
          <p>${escapeHtml(item.analyse_impact_bci || "Non renseignee.")}</p>
        </div>
        <div class="detail-section">
          <h3>Actions a mener</h3>
          ${item.actions_a_mener && item.actions_a_mener.length
            ? `<ul class="action-list">${item.actions_a_mener.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`
            : `<p>Aucune action enregistree.</p>`}
        </div>
        <div class="detail-section">
          <h3>Procedures BCI impactees</h3>
          ${item.procedures_impactees && item.procedures_impactees.length
            ? `<ul class="procedure-list">${item.procedures_impactees.map((p) => `<li><span class="procedure-code">${escapeHtml(p)}</span></li>`).join("")}</ul>`
            : `<p>Aucune procedure associee.</p>`}
        </div>
      </div>

      <div>
        <div class="detail-section source-box">
          <div>Source officielle</div>
          ${item.lien_source
            ? `<a href="${escapeHtml(item.lien_source)}" target="_blank" rel="noopener noreferrer">Consulter le texte source &#8599;</a>
               <div class="source-domain">${escapeHtml(sourceHost)}</div>`
            : `<p>Aucun lien source renseigne.</p>`}
        </div>
        <div class="detail-section">
          <h3>Suivi</h3>
          <ul class="sidebar-meta-list">
            <li><span class="k">Autorite</span><span class="v">${escapeHtml(item.autorite || "-")}</span></li>
            <li><span class="k">Type d'acte</span><span class="v">${TYPE_ACTE_LABELS[item.type_acte] || item.type_acte || "-"}</span></li>
            <li><span class="k">Priorite</span><span class="v">${PRIORITE_LABELS[item.priorite] || "-"}</span></li>
            <li><span class="k">Statut</span><span class="v">${STATUT_LABELS[item.statut] || "-"}</span></li>
            <li><span class="k">Ajoute le</span><span class="v">${formatDate(item.date_ajout) || "-"}</span></li>
            <li><span class="k">Derniere mise a jour</span><span class="v">${formatDate(item.date_maj) || "-"}</span></li>
            <li><span class="k">Origine</span><span class="v">${item.origine === "automatique" ? "Flux automatise" : "Saisie manuelle"}</span></li>
          </ul>
        </div>
        <div class="detail-section no-print">
          <button class="btn btn-secondary" id="btn-print-item" type="button" style="width:100%;">Imprimer cette fiche</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-print-item")?.addEventListener("click", () => window.print());
}

// ------------------------------------------------------------------
// Recherche globale (barre d'en-tete)
// ------------------------------------------------------------------

SEARCH.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const p = new URLSearchParams();
    if (SEARCH.value.trim()) p.set("q", SEARCH.value.trim());
    navigate("/liste", p);
  }
});

// ------------------------------------------------------------------
// Demarrage
// ------------------------------------------------------------------

(async function init() {
  await loadData();
  router();
})();
