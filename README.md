# Veille reglementaire et juridique - Boetie Capital Invest

Plateforme interne de veille reglementaire pour BCI (CIF / COA, perimetre France / Luxembourg),
en deux parties :

1. **`veille_bci.py`** : pipeline automatise (flux RSS des autorites -> digest email hebdomadaire
   + mise a jour de `veille.json`).
2. **La plateforme web statique** (`index.html` + `assets/`) : consulte `veille.json` pour offrir
   un tableau de bord, une liste filtrable, une frise des echeances et une fiche detail par element,
   deployable sur GitHub Pages sans backend.

Tout le contenu et l'interface sont en francais. Aucun tiret cadratin dans les textes, uniquement
des tirets simples.

---

## 1. La plateforme web

### Lancer en local

Le navigateur bloque `fetch()` sur un fichier ouvert en `file://`. Servez le dossier avec un petit
serveur local, par exemple :

```bash
python3 -m http.server 8000
```

puis ouvrez `http://localhost:8000/`.

### Structure

```
index.html                  Page unique (routeur par hash, sans framework ni etape de build)
assets/css/style.css        Styles (palette maison navy/gold, responsive, impression)
assets/js/constants.js      Enumerations et libelles du modele de donnees
assets/js/utils.js          Fonctions utilitaires (dates, export CSV, etc.)
assets/js/app.js            Chargement des donnees, routeur, rendu des 4 vues
veille.json                 Donnees consommees par la plateforme (voir section 2)
veille.schema.json          Schema JSON du fichier veille.json
```

Quatre vues, routees par ancre (`#/`, `#/liste`, `#/echeances`, `#/item/<id>`), donc compatibles
avec un hebergement statique pur (GitHub Pages) sans configuration serveur particuliere :

- **Tableau de bord** (`#/`) : compteurs par priorite, derniers elements ajoutes, echeances des
  90 prochains jours.
- **Liste** (`#/liste`) : filtres (domaine, autorite, perimetre, priorite, statut), recherche plein
  texte, tri, export CSV, impression / PDF.
- **Echeances** (`#/echeances`) : frise chronologique des dates d'entree en application.
- **Fiche detail** (`#/item/<id>`) : resume, explication, analyse d'impact, actions a mener,
  procedures BCI impactees, lien source officiel, bouton retour.

Chaque fiche distingue visuellement (badges) :
- **Resume genere - a valider** / **Resume valide** (champ `resume_valide`) : ne jamais confondre
  une synthese interne, meme validee, avec le texte officiel.
- **Exemple fictif** (champ `donnee_fictive`) : marque les elements de demonstration a supprimer.

### Ajouter un element a la main

Ouvrir `veille.json`, dupliquer un objet existant dans le tableau `elements`, et renseigner les
champs (voir `veille.schema.json` pour la liste complete et les valeurs autorisees). Points
importants :

- `id` : identifiant unique, libre pour une saisie manuelle (ex. `MANUEL-2026-001`).
- `resume_valide: true` des que le contenu a ete relu par la conformite (sinon laisser `false`).
- `lien_source` : toujours un lien verifiable vers le texte ou communique officiel. Ne jamais
  inventer une reference ou une date d'entree en vigueur : si l'information n'est pas confirmee,
  laisser le champ vide plutot que de supposer.
- Ne pas oublier `donnee_fictive: true` uniquement pour un exemple de demonstration ; l'omettre (ou
  le laisser absent) pour un element reel.

Le fichier peut aussi etre valide avec n'importe quel validateur JSON Schema standard contre
`veille.schema.json`.

### Deployer sur GitHub Pages

1. Pousser ce depot sur GitHub (prive ou public selon la politique du cabinet ; prive recommande
   tant que du contenu reel de conformite y figure).
2. Settings > Pages > Source : "Deploy from a branch", branche `main`, dossier `/ (root)`.
3. La plateforme est servie a `https://<org>.github.io/<depot>/` en quelques minutes. Aucune etape
   de build n'est necessaire : `index.html` et `veille.json` sont a la racine.
4. Chaque mise a jour de `veille.json` (manuelle ou via le workflow automatique, cf. section 2)
   pousse une nouvelle version du site des le prochain chargement de page.

### Option non retenue par defaut : persistance / edition en ligne

La plateforme livree est volontairement statique (pas de backend, pas de base de donnees) :
c'est le livrable par defaut. Une evolution possible consisterait a ajouter un formulaire
d'ajout/edition en ligne avec persistance (ex. petite API + base de donnees, ou un backend-as-a-
service). Cela sort du perimetre de ce livrable et supposerait de traiter separement
l'authentification (seule la Responsable Conformite doit pouvoir modifier les donnees), la
journalisation des modifications (tracabilite exigee dans un dispositif de conformite) et
l'hebergement (GitHub Pages ne peut pas heberger de backend). A envisager comme un chantier
distinct si le besoin d'edition multi-utilisateurs se confirme.

---

## 2. Le pipeline de veille (`veille_bci.py`)

Dispositif de veille en deux moities complementaires, sans doublon :

1. **Abonnements officiels** (zero code) pour les sources sans flux RSS exploitable ou liees a un
   compte / espace adherent.
2. **Digest hebdomadaire automatise** (ce script) pour les flux a URL stable : filtre sur le
   perimetre BCI, classe par theme, **met a jour `veille.json`**, envoie un digest par email.

### Moitie 1 : abonnements officiels a activer une fois

URLs verifiees par requete reelle le 02/09/2026 (voir section 3 pour le detail complet, y compris
les flux RSS confirmes).

| Source | Quoi | Comment |
|---|---|---|
| **AMF** | Alerte hebdomadaire | amf-france.org > Abonnements et flux RSS > cocher les contenus utiles en frequence hebdo |
| **ACPR** | Notifications / publications | acpr.banque-france.fr/fr/actualites-publications > pas de flux RSS identifie, s'abonner aux publications |
| **CAA Luxembourg** | Actualites / circulaires | caa.lu/fr/actualites > pas de flux RSS identifie, consultation reguliere ou abonnement newsletter |
| **TRACFIN** | Lignes directrices, listes pays | economie.gouv.fr/tracfin/toutes-les-actualites, frequence faible |
| **ORIAS** | Registre des intermediaires, actualites | orias.fr (actualites affichees en page d'accueil, pas de flux dedie) |
| **CNCGP** | Veille adherent | cncgp.fr/actualites/les-publications-de-la-cncgp + espace adherent BCI |
| **EUR-Lex (complement)** | Alertes email par recherche sauvegardee | Creer un compte EU Login, recherche avancee (ex. AMLA, AMLR, AIFM2), "Create an email alert" ; complementaire aux flux RSS deja integres au script (JO series L et C) |

Resultat : un libelle Gmail dedie "Veille reglementaire BCI" + filtres qui rangent ces emails
automatiquement.

### Moitie 2 : le digest automatise

#### Ce qu'il fait

- Lit les flux RSS listes dans `FEEDS` (`veille_bci.py`) : AMF, ESMA, EBA, EIOPA, EUR-Lex (JO series
  L et C), CSSF.
- Ne garde que les items qui matchent le perimetre BCI (CIF, COA, LCB-FT, assurance-vie, fonds),
  classes par theme.
- **Met a jour `veille.json`** : chaque nouvel item devient un brouillon (`resume_valide: false`,
  `statut: a_analyser`, `priorite: moyen` par defaut, analyse d'impact vide) a completer et valider
  par la Responsable Conformite. Un item deja present n'est jamais ecrase sur ses champs manuels
  (explication, analyse d'impact, priorite, statut, echeance, actions, procedures, domaines,
  perimetre, type d'acte, validation) : seuls titre, date, resume court et lien sont resynchronises
  avec le flux.
- Construit un email aux couleurs maison et l'envoie chaque vendredi (inchange par rapport a la
  version precedente du script).

#### A propos du flux JORF

Le flux precedemment utilise (`legifrss.org`) est un **miroir communautaire non officiel** (il
s'auto-designe explicitement "non-official RSS feed for Legifrance"). Un cabinet regule ne doit pas
alimenter sa veille de conformite avec une source tierce non garantie : ce flux a ete **desactive**
dans `FEEDS` (commente, avec l'explication en tete de fichier). Aucun flux RSS officiel Legifrance
n'a ete identifie a ce jour ; l'evolution recommandee est l'API Legifrance (PISTE), voir section 4.
En attendant, le JORF reste couvert par une veille manuelle.

#### Resumes : deux niveaux

- **Sans rien faire** : chaque element porte un extrait, et la synthese de tete liste les volumes
  par theme.
- **Avec une cle API Anthropic** (facultatif) : la synthese de tete est redigee par un modele Claude
  (Haiku, cout negligeable). Definir `ANTHROPIC_API_KEY` (en local, ou en secret GitHub). Sans elle,
  le script bascule automatiquement sur la synthese simple. Cette synthese email reste distincte de
  `veille.json` : elle ne redige jamais l'explication detaillee ni l'analyse d'impact d'un element,
  qui restent manuelles.

### Etape 1 : tester en local

```bash
pip install -r requirements.txt
python veille_bci.py --test       # affiche les flux joignables et le nombre d'items retenus
python veille_bci.py --dry-run    # ecrit digest.html + met a jour veille.json, sans envoyer d'email
```

Si un flux renvoie ERREUR, verifier son URL dans `FEEDS` (les autorites changent parfois leurs
endpoints ; toujours reverifier avant de remettre en service un flux desactive).

### Etape 2 : credentials email (a creer toi-meme, jamais dans le code)

Avec une adresse Gmail : Compte Google > Securite > Validation en 2 etapes > **Mots de passe
d'application**, generer un mot de passe dedie. Variables attendues : `SMTP_USER`, `SMTP_PASS`,
`MAIL_TO` (`SMTP_HOST` / `SMTP_PORT` optionnels, defaut Gmail SSL).

### Etape 3 : automatiser chaque vendredi

**GitHub Actions** (recommande) : le workflow `.github/workflows/veille.yml` s'execute le vendredi
09:00 UTC, envoie l'email et **committe automatiquement `veille.json`** si de nouveaux elements ont
ete detectes (necessite la permission `contents: write`, deja configuree dans le workflow).

1. Depot GitHub (prive recommande), y deposer ces fichiers.
2. Settings > Secrets and variables > Actions > ajouter `SMTP_USER`, `SMTP_PASS`, `MAIL_TO` (et
   `SMTP_HOST` / `SMTP_PORT` si non-Gmail, `ANTHROPIC_API_KEY` si synthese par Claude souhaitee).
3. Bouton "Run workflow" pour un test immediat depuis l'onglet Actions.

---

## 3. Sources officielles : etat verifie (02/09/2026)

Verification effectuee par requete HTTP reelle sur chaque URL. A revalider periodiquement : les
autorites changent leurs endpoints sans preavis.

| Autorite | Page d'accueil | Actualites / publications | Flux RSS |
|---|---|---|---|
| AMF | amf-france.org | amf-france.org/fr/actualites-publications/communiques/communiques-de-lamf | Oui, integre au script (`display/30`, `display/26`) |
| ACPR | acpr.banque-france.fr | acpr.banque-france.fr/fr/actualites-publications | Aucun identifie |
| CAA Luxembourg | caa.lu | caa.lu/fr/actualites | Aucun identifie |
| CSSF | cssf.lu | cssf.lu/en/press-room | Oui, integre au script (`cssf.lu/en/feed/publications`) |
| TRACFIN | economie.gouv.fr/tracfin | economie.gouv.fr/tracfin/toutes-les-actualites | Aucun identifie |
| ESMA | esma.europa.eu | esma.europa.eu/press-news/esma-news | Oui, integre au script (`esma.europa.eu/rss.xml`) |
| EIOPA | eiopa.europa.eu | eiopa.europa.eu/publications_en | Oui, integre au script (`eiopa.europa.eu/node/3/rss_en`) |
| EBA (complement prudentiel) | eba.europa.eu | eba.europa.eu/publications-and-media | Oui, integre au script (`eba.europa.eu/rss.xml`) |
| Legifrance / JORF | legifrance.gouv.fr | legifrance.gouv.fr/jorf/jo | Aucun flux officiel identifie ; le miroir tiers precedemment utilise a ete retire (voir section 2) |
| EUR-Lex | eur-lex.europa.eu | eur-lex.europa.eu/homepage.html | Oui, integre au script (JO serie L : `rssId=222`, JO serie C : `rssId=221`) |
| ORIAS | orias.fr | Pas de page dediee identifiee (actualites en page d'accueil) | Aucun identifie |
| CNCGP | cncgp.fr | cncgp.fr/actualites/les-publications-de-la-cncgp | Aucun identifie |

Les autorites sans flux RSS restent couvertes par la veille manuelle (section 1, "Abonnements
officiels").

---

## 4. Evolutions possibles (phase 2)

- **API Legifrance (PISTE)** a la place d'un flux communautaire non officiel : compte gratuit sur
  piste.gouv.fr, filtrage fin sur le CMF par article et mot-cle. Brancher dans une fonction
  `fetch_legifrance()` en complement de `FEEDS`.
- **Archivage** : pousser chaque digest et chaque version de `veille.json` dans le Drive Compliance
  BCI pour constituer le journal de veille date (artefact opposable en controle).
- **Mots-cles** : ajuster les listes dans `THEMES` (`veille_bci.py`) au fil des priorites (AMLA,
  opt-in demarchage, AIFM2).
- **Edition en ligne avec persistance** : voir "Option non retenue par defaut" en section 1.
