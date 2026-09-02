#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Veille reglementaire BCI - digest hebdomadaire + alimentation de la plateforme.

Recupere les flux RSS des autorites (AMF, JORF, autorites europeennes),
filtre sur le perimetre reglementaire de BCI (CIF / COA / LCB-FT / assurance-vie
/ fonds), classe par theme, envoie un recapitulatif email ET met a jour
veille.json (fichier de donnees consomme par la plateforme web statique).

Usage :
    python veille_bci.py --test       # teste la joignabilite des flux, n'envoie rien
    python veille_bci.py --dry-run    # construit digest.html + met a jour veille.json, n'envoie rien
    python veille_bci.py              # construit, met a jour veille.json et envoie l'email

Identifiants email lus depuis les variables d'environnement (jamais en dur) :
    SMTP_HOST   (defaut: smtp.gmail.com)
    SMTP_PORT   (defaut: 465, SSL)
    SMTP_USER   adresse expeditrice
    SMTP_PASS   mot de passe d'application (Gmail : App Password)
    MAIL_TO     destinataire(s), separes par des virgules

Important sur veille.json : chaque nouvel item detecte par un flux est insere
comme BROUILLON (resume_valide=false, priorite/statut par defaut, analyse
d'impact vide). Ces brouillons sont a completer et valider par la Responsable
Conformite dans la plateforme ou directement dans le fichier. Les champs
manuels d'un item deja present (explication, analyse d'impact, priorite,
statut, echeance, actions, procedures, domaines, perimetre, type d'acte,
validation) ne sont JAMAIS ecrases par une execution ulterieure du script :
seuls le titre, la date de publication, le resume court et le lien source
sont resynchronises avec le flux.
"""

import argparse
import hashlib
import os
import re
import sys
import time
import json
import smtplib
import ssl
import html as htmllib
import urllib.request
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import feedparser

# --------------------------------------------------------------------------
# 1. PARAMETRES
# --------------------------------------------------------------------------

# Fenetre de collecte : on garde les items publies dans les N derniers jours.
# 8 jours pour absorber le decalage de la cadence du vendredi sans rien rater.
WINDOW_DAYS = 8

# Nombre maximum d'items affiches par theme (au-dela : "+N autres").
MAX_PER_THEME = 12

# --------------------------------------------------------------------------
# 2. FLUX SUIVIS
#    Sources a URL stable, verifiees le 02/09/2026 (requete HTTP reelle sur
#    chaque URL). ACPR / CAA Luxembourg / TRACFIN / ORIAS / CNCGP n'ont pas de
#    flux RSS officiel identifie a cette date : ils restent sur les
#    abonnements email (cf. README, "Moitie 1"), pas sur ce script.
#    Lance d'abord `--test` : il dira lesquels repondent et combien d'items.
# --------------------------------------------------------------------------

FEEDS = [
    # --- France ---
    {"name": "AMF - Actualites",        "url": "https://www.amf-france.org/fr/flux-rss/display/30"},
    {"name": "AMF - Colloques / RCCI",  "url": "https://www.amf-france.org/fr/flux-rss/display/26"},
    # JORF : aucun flux RSS officiel Legifrance identifie a ce jour.
    # "legifrss.org" (ancien flux utilise ici) est un miroir COMMUNAUTAIRE NON
    # OFFICIEL (le flux s'auto-designe "non-official RSS feed for Legifrance").
    # Desactive par defaut : ne pas alimenter une plateforme de conformite avec
    # une source tierce non garantie. Evolution recommandee (cf. README,
    # "Evolutions possibles") : integrer l'API Legifrance (PISTE, gratuite).
    # {"name": "JORF (miroir non officiel - a valider)", "url": "https://legifrss.org/latest"},

    # --- Autorites europeennes ---
    {"name": "ESMA - News",   "url": "https://www.esma.europa.eu/rss.xml"},
    {"name": "EBA - News",    "url": "https://www.eba.europa.eu/rss.xml"},
    {"name": "EIOPA - News",  "url": "https://www.eiopa.europa.eu/node/3/rss_en"},
    {"name": "EUR-Lex - JO serie L", "url": "https://eur-lex.europa.eu/FR/display-feed.rss?rssId=222"},
    {"name": "EUR-Lex - JO serie C", "url": "https://eur-lex.europa.eu/FR/display-feed.rss?rssId=221"},

    # --- Luxembourg ---
    {"name": "CSSF - Publications", "url": "https://www.cssf.lu/en/feed/publications"},
]

# Association flux -> autorite au sens du modele de donnees de la plateforme
# (champ "autorite"). A completer si un flux est ajoute ci-dessus.
FEED_TO_AUTORITE = {
    "AMF - Actualites": "AMF",
    "AMF - Colloques / RCCI": "AMF",
    "JORF (miroir non officiel - a valider)": "Legifrance / JORF",
    "ESMA - News": "ESMA",
    "EBA - News": "EBA",
    "EIOPA - News": "EIOPA",
    "EUR-Lex - JO serie L": "EUR-Lex",
    "EUR-Lex - JO serie C": "EUR-Lex",
    "CSSF - Publications": "CSSF",
}

# Perimetre juridictionnel deductible de maniere fiable depuis l'autorite
# source (contrairement au theme, la juridiction ne varie pas d'un item a
# l'autre pour une meme autorite).
AUTORITE_TO_PERIMETRE = {
    "AMF": ["France"],
    "ACPR": ["France"],
    "TRACFIN": ["France"],
    "ORIAS": ["France"],
    "CNCGP": ["France"],
    "Legifrance / JORF": ["France"],
    "CSSF": ["Luxembourg"],
    "CAA Luxembourg": ["Luxembourg"],
}

# Traduction du theme de classification (cf. THEMES ci-dessous) vers les
# domaines BCI du modele de donnees de la plateforme (champ "domaines").
THEME_TO_DOMAINES = {
    "LCB-FT / Gel des avoirs": ["LCB-FT"],
    "CIF / Demarchage / Conseil": ["CIF / MiFID II", "demarchage"],
    "Assurance-vie / COA / Luxembourg": ["DDA"],
    "Fonds / FIC / AIFM": [],
    "Transversal (RGPD / DORA / ESG)": ["RGPD", "SFDR / durabilite", "prudentiel"],
}

# Le theme "Fonds / FIC / AIFM" ne correspond a aucun domaine BCI precis mais
# indique un perimetre : les items concernes touchent les FIC.
THEME_TO_PERIMETRE_EXTRA = {
    "Fonds / FIC / AIFM": ["FIC"],
    "Assurance-vie / COA / Luxembourg": ["COA", "assurance-vie"],
}

# --------------------------------------------------------------------------
# 3. THEMES & MOTS-CLES (perimetre BCI)
#    Un item est retenu s'il matche au moins un theme. Ordre = priorite.
#    Les mots-cles sont volontairement precis : sur une source a fort volume
#    comme le JORF, des termes generiques ("fonds", "sanctions", "remuneration")
#    generent trop de faux positifs. On privilegie les termes et acronymes
#    propres au perimetre, avec une correspondance par MOT ENTIER (cf. classify).
# --------------------------------------------------------------------------

THEMES = {
    "LCB-FT / Gel des avoirs": [
        "lcb-ft", "lcbft", "blanchiment", "financement du terrorisme", "tracfin",
        "gel des avoirs", "sanctions financieres", "amla", "amlr", "amld", "amld6",
        "aml", "beneficiaire effectif", "beneficiaires effectifs",
        "personne politiquement exposee", "politiquement exposee", "ppe",
        "mesures de vigilance", "vigilance constante", "gafi", "fatf",
    ],
    "CIF / Demarchage / Conseil": [
        "cif", "conseiller en investissements financiers",
        "conseillers en investissements financiers", "demarchage",
        "mifid", "mif ii", "directive mif", "adequation",
        "conflits d'interets", "conflit d'interets", "inducement", "inducements",
        "retrocession", "retrocessions", "cncgp", "doc-2006-23", "spot",
        "controle interne", "rcci", "rcsi",
    ],
    "Assurance-vie / COA / Luxembourg": [
        "assurance-vie", "assurance vie", "coa", "intermediaire en assurance",
        "dda", "directive distribution", "devoir de conseil", "clause beneficiaire",
        "clauses beneficiaires", "contrat d'assurance", "unites de compte",
        "wealins", "generali", "swiss life", "utmost", "edmond de rothschild",
    ],
    "Fonds / FIC / AIFM": [
        "aifm", "aifm2", "aifmd", "fia", "fic", "societe de gestion",
        "societes de gestion", "opcvm", "fonds d'investissement", "fonds alternatif",
        "fonds alternatifs", "gestion d'actifs", "gestion collective", "eltif", "auris",
    ],
    "Transversal (RGPD / DORA / ESG)": [
        "rgpd", "donnees personnelles", "dora", "resilience operationnelle",
        "sfdr", "csrd", "durabilite", "greenwashing", "esg",
    ],
}


def _normalize(s: str) -> str:
    """Minuscule, sans accents, apostrophes/traits-d'union/points -> espaces."""
    s = s.lower().translate(str.maketrans(
        "àâäáãéèêëíìîïóòôöõúùûüçñ",
        "aaaaaeeeeiiiiooooouuuucn",
    ))
    for ch in "'\u2019\u2018-\u2013\u2014/.,;:()":
        s = s.replace(ch, " ")
    return re.sub(r"\s+", " ", s).strip()


def _matches(blob: str, keyword: str) -> bool:
    """Correspondance par mot entier (evite les faux positifs sur sous-chaines)."""
    k = _normalize(keyword)
    if not k:
        return False
    return re.search(r"(?<!\w)" + re.escape(k) + r"(?!\w)", blob) is not None


def classify(title: str, summary: str):
    """Retourne le premier theme qui matche, sinon None (item hors perimetre)."""
    blob = _normalize(f"{title} {summary}")
    for theme, keywords in THEMES.items():
        for kw in keywords:
            if _matches(blob, kw):
                return theme
    return None


# --------------------------------------------------------------------------
# 4. COLLECTE
# --------------------------------------------------------------------------

def _entry_datetime(entry):
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime.fromtimestamp(time.mktime(t), tz=timezone.utc)
    return None


def _clean_text(s: str, limit: int = 220) -> str:
    """Retire le HTML, decode les entites, condense les espaces, tronque proprement."""
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = htmllib.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "..."
    return s


def fetch_feed(feed, window_start):
    """Retourne (items, status). items = liste de dict; status = message de test."""
    items = []
    try:
        parsed = feedparser.parse(feed["url"])
        if parsed.bozo and not parsed.entries:
            return items, f"ERREUR ({parsed.bozo_exception})"
        kept = 0
        for e in parsed.entries:
            dt = _entry_datetime(e)
            if dt is not None and dt < window_start:
                continue
            title = (e.get("title") or "").strip()
            summary = (e.get("summary") or e.get("description") or "").strip()
            link = e.get("link") or ""
            theme = classify(title, summary)
            if theme is None:
                continue
            items.append({
                "theme": theme, "title": title, "link": link,
                "date": dt, "source": feed["name"],
                "excerpt": _clean_text(summary),
            })
            kept += 1
        return items, f"OK ({len(parsed.entries)} items, {kept} retenus)"
    except Exception as exc:  # noqa: BLE001
        return items, f"ERREUR ({exc})"


def collect(window_days=WINDOW_DAYS, verbose=False):
    window_start = datetime.now(timezone.utc) - timedelta(days=window_days)
    all_items, report = [], []
    for feed in FEEDS:
        items, status = fetch_feed(feed, window_start)
        report.append((feed["name"], status))
        all_items.extend(items)
        if verbose:
            print(f"  - {feed['name']:32s} {status}")
    # Dedoublonnage par lien
    seen, deduped = set(), []
    for it in sorted(all_items, key=lambda x: x["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        if it["link"] in seen:
            continue
        seen.add(it["link"])
        deduped.append(it)
    return deduped, report


# --------------------------------------------------------------------------
# 5. MISE EN FORME (HTML maison BCI)
# --------------------------------------------------------------------------

NAVY = "#1f4e79"
GOLD = "#e4be69"

# Modele utilise pour la synthese (peu couteux). Necessite ANTHROPIC_API_KEY.
SUMMARY_MODEL = "claude-haiku-4-5"


def summarize_week(items):
    """Synthese de la semaine.
    Avec ANTHROPIC_API_KEY : redaction par un modele Claude (un seul appel).
    Sans cle : synthese simple par compteurs de themes.
    """
    if not items:
        return ""

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        counts = {}
        for it in items:
            short = it["theme"].split(" / ")[0].split(" (")[0]
            counts[short] = counts.get(short, 0) + 1
        bits = ", ".join(f"{n} en {t}" for t, n in counts.items())
        return f"{len(items)} publication(s) sur le perimetre cette semaine : {bits}."

    corpus = "\n".join(
        f"[{it['theme']}] {it['title']}. {it.get('excerpt', '')} (source : {it['source']})"
        for it in items[:60]
    )
    prompt = (
        "Tu es l'assistant conformite d'un cabinet de gestion de patrimoine francais "
        "(statut CIF et COA, membre CNCGP, distribution d'assurance-vie luxembourgeoise "
        "et de fonds proprietaires). Voici les publications reglementaires de la semaine, "
        "deja filtrees sur notre perimetre. Redige une synthese en francais, 4 a 7 phrases "
        "maximum, qui va a l'essentiel : ce qui change et ce qui merite une action ou une "
        "vigilance de notre part. Regroupe par enjeu, sans liste a puces ni formule "
        "d'introduction. N'invente rien qui ne figure pas dans les elements fournis.\n\n"
        f"{corpus}"
    )
    payload = json.dumps({
        "model": SUMMARY_MODEL,
        "max_tokens": 700,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        ).strip()
        return text or f"{len(items)} publication(s) cette semaine."
    except Exception as exc:  # noqa: BLE001
        return f"(Synthese automatique indisponible : {exc}) {len(items)} publication(s) cette semaine."


def build_html(items, synthesis=""):
    by_theme = {t: [] for t in THEMES}
    for it in items:
        by_theme[it["theme"]].append(it)

    today = datetime.now().strftime("%d/%m/%Y")
    total = len(items)

    parts = [f"""<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#222;">
  <div style="border-bottom:3px solid {GOLD};padding-bottom:12px;margin-bottom:20px;">
    <div style="font-size:22px;color:{NAVY};font-weight:bold;">Veille reglementaire BCI</div>
    <div style="font-size:13px;color:#666;">Semaine du {today} &middot; {total} element(s) sur le perimetre</div>
  </div>"""]

    if synthesis:
        parts.append(
            f'<div style="background:#f6f3ec;border-left:4px solid {GOLD};padding:12px 14px;'
            f'margin-bottom:18px;font-size:13px;line-height:1.55;color:#333;">'
            f'<div style="font-weight:bold;color:{NAVY};margin-bottom:5px;">Synthese de la semaine</div>'
            f'{htmllib.escape(synthesis)}</div>'
        )

    if total == 0:
        parts.append(f'<p style="color:#666;">Aucune publication sur le perimetre BCI cette semaine. '
                     f'Les abonnements officiels (AMF du vendredi, EUR-Lex) restent la source complementaire.</p>')
    else:
        for theme, theme_items in by_theme.items():
            if not theme_items:
                continue
            parts.append(f'<div style="margin:18px 0 6px;font-size:15px;color:{NAVY};'
                         f'font-weight:bold;border-left:4px solid {GOLD};padding-left:8px;">'
                         f'{theme} <span style="color:#999;font-weight:normal;">({len(theme_items)})</span></div>')
            shown = theme_items[:MAX_PER_THEME]
            for it in shown:
                d = it["date"].strftime("%d/%m") if it["date"] else ""
                excerpt = it.get("excerpt", "")
                exc_html = (f'<div style="font-size:12px;color:#555;margin-top:2px;line-height:1.45;">'
                            f'{htmllib.escape(excerpt)}</div>') if excerpt else ""
                parts.append(
                    f'<div style="margin:10px 0;padding-left:12px;">'
                    f'<a href="{it["link"]}" style="color:{NAVY};text-decoration:none;font-size:14px;font-weight:bold;">{htmllib.escape(it["title"])}</a>'
                    f'{exc_html}'
                    f'<div style="font-size:11px;color:#999;margin-top:2px;">{it["source"]} &middot; {d}</div></div>'
                )
            extra = len(theme_items) - len(shown)
            if extra > 0:
                parts.append(f'<div style="font-size:12px;color:#999;padding-left:12px;">+ {extra} autre(s)</div>')

    parts.append(f"""
  <div style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#999;">
    Genere automatiquement le {today}. Sources filtrees sur le perimetre CIF / COA / LCB-FT / assurance-vie / fonds.
    Ce digest est un artefact de veille a archiver (dispositif de conformite, niveau 3).
  </div>
</div>""")
    return "\n".join(parts)


def build_text(items, synthesis=""):
    lines = [f"Veille reglementaire BCI - semaine du {datetime.now().strftime('%d/%m/%Y')}",
             f"{len(items)} element(s)", ""]
    if synthesis:
        lines += ["SYNTHESE DE LA SEMAINE", synthesis, ""]
    by_theme = {t: [] for t in THEMES}
    for it in items:
        by_theme[it["theme"]].append(it)
    for theme, theme_items in by_theme.items():
        if not theme_items:
            continue
        lines.append(f"== {theme} ({len(theme_items)}) ==")
        for it in theme_items[:MAX_PER_THEME]:
            d = it["date"].strftime("%d/%m") if it["date"] else ""
            lines.append(f"- {it['title']} [{it['source']} {d}]")
            if it.get("excerpt"):
                lines.append(f"  {it['excerpt']}")
            lines.append(f"  {it['link']}")
        lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 6. GENERATION / MISE A JOUR DE VEILLE.JSON (donnees de la plateforme)
# --------------------------------------------------------------------------

VEILLE_JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "veille.json")

# Champs geres exclusivement par la Responsable Conformite : jamais ecrases
# par une resynchronisation automatique, y compris si le flux source change.
CHAMPS_PROTEGES_MANUELS = (
    "explication_detaillee", "analyse_impact_bci", "priorite", "statut",
    "date_echeance", "actions_a_mener", "procedures_impactees",
    "resume_valide", "domaines", "perimetre", "type_acte", "donnee_fictive",
)


def make_item_id(link: str) -> str:
    """Identifiant stable derive du lien (memes items -> meme id d'une execution a l'autre)."""
    return "AUTO-" + hashlib.sha1(link.encode("utf-8")).hexdigest()[:10].upper()


def load_veille_json(path: str = VEILLE_JSON_PATH) -> dict:
    if not os.path.exists(path):
        return {
            "meta": {
                "titre": "Veille reglementaire et juridique - Boetie Capital Invest",
                "schema_version": "1.0",
                "avertissement": None,
                "derniere_generation_automatique": None,
            },
            "elements": [],
        }
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def feed_item_to_element(it: dict) -> dict:
    """Convertit un item collecte (flux RSS) en brouillon d'element veille.json."""
    autorite = FEED_TO_AUTORITE.get(it["source"], it["source"])
    domaines = list(THEME_TO_DOMAINES.get(it["theme"], []))
    perimetre = list(AUTORITE_TO_PERIMETRE.get(autorite, []))
    for extra in THEME_TO_PERIMETRE_EXTRA.get(it["theme"], []):
        if extra not in perimetre:
            perimetre.append(extra)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    date_pub = it["date"].strftime("%Y-%m-%d") if it.get("date") else today
    return {
        "id": make_item_id(it["link"]),
        "titre": it["title"],
        "date_publication": date_pub,
        "autorite": autorite,
        "type_acte": None,
        "domaines": domaines,
        "perimetre": perimetre,
        "resume_court": it.get("excerpt", ""),
        "explication_detaillee": "",
        "analyse_impact_bci": "",
        "priorite": "moyen",
        "statut": "a_analyser",
        "date_echeance": None,
        "actions_a_mener": [],
        "procedures_impactees": [],
        "lien_source": it["link"],
        "date_ajout": today,
        "date_maj": today,
        "resume_valide": False,
        "origine": "automatique",
    }


def merge_items_into_veille_json(items: list, path: str = VEILLE_JSON_PATH, verbose: bool = False) -> dict:
    """Fusionne les items collectes dans veille.json sans ecraser les champs
    completes manuellement par la conformite. Nouveaux items -> brouillon a
    valider. Items existants -> seuls titre / date / resume / lien sont
    resynchronises (et date_maj bumpee uniquement si l'un d'eux a change).
    """
    data = load_veille_json(path)
    by_id = {el["id"]: el for el in data.get("elements", []) if "id" in el}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    created, updated = 0, 0

    for it in items:
        draft = feed_item_to_element(it)
        existing = by_id.get(draft["id"])
        if existing is None:
            by_id[draft["id"]] = draft
            created += 1
            continue
        changed = any(existing.get(k) != draft[k] for k in ("titre", "date_publication", "resume_court", "lien_source"))
        for k in ("titre", "date_publication", "resume_court", "lien_source", "autorite"):
            existing[k] = draft[k]
        if changed:
            existing["date_maj"] = today
            updated += 1

    data["elements"] = list(by_id.values())
    data["meta"]["derniere_generation_automatique"] = today
    data.setdefault("meta", {}).setdefault("schema_version", "1.0")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    if verbose:
        print(f"veille.json mis a jour : {created} nouveau(x) brouillon(s), {updated} element(s) resynchronise(s), "
              f"{len(data['elements'])} au total.")
    return data


# --------------------------------------------------------------------------
# 7. ENVOI
# --------------------------------------------------------------------------

def send_email(html, text):
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    mail_to = os.getenv("MAIL_TO")

    missing = [k for k, v in {"SMTP_USER": user, "SMTP_PASS": password, "MAIL_TO": mail_to}.items() if not v]
    if missing:
        print(f"Variables manquantes : {', '.join(missing)}. Email non envoye.", file=sys.stderr)
        sys.exit(1)

    recipients = [a.strip() for a in mail_to.split(",") if a.strip()]
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Veille reglementaire BCI - semaine du {datetime.now().strftime('%d/%m/%Y')}"
    msg["From"] = user
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=context) as server:
        server.login(user, password)
        server.sendmail(user, recipients, msg.as_string())
    print(f"Email envoye a {', '.join(recipients)}.")


# --------------------------------------------------------------------------
# 8. ENTREE
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Veille reglementaire BCI")
    ap.add_argument("--test", action="store_true", help="Teste les flux, n'envoie rien")
    ap.add_argument("--dry-run", action="store_true", help="Ecrit digest.html + veille.json sans envoyer d'email")
    ap.add_argument("--days", type=int, default=WINDOW_DAYS, help="Fenetre de collecte en jours")
    ap.add_argument("--no-json", action="store_true", help="Ne met pas a jour veille.json")
    args = ap.parse_args()

    if args.test:
        print(f"Test des flux (fenetre {args.days} j) :")
        items, report = collect(window_days=args.days, verbose=True)
        print(f"\nTotal retenu sur le perimetre BCI : {len(items)}")
        return

    items, _ = collect(window_days=args.days)
    synthesis = summarize_week(items)
    html, text = build_html(items, synthesis), build_text(items, synthesis)

    if not args.no_json:
        merge_items_into_veille_json(items, verbose=True)

    if args.dry_run:
        with open("digest.html", "w", encoding="utf-8") as f:
            f.write(html)
        print(f"digest.html ecrit ({len(items)} elements).")
        return

    send_email(html, text)


if __name__ == "__main__":
    main()
