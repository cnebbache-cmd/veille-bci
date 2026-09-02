// Libelles et enumerations du modele de donnees veille.json.
// Toute valeur presente dans les donnees mais absente d'ici est affichee telle quelle (repli).

export const AUTORITES = [
  "AMF", "ACPR", "CAA Luxembourg", "CSSF", "TRACFIN",
  "ESMA", "EIOPA", "Legifrance / JORF", "EUR-Lex", "ORIAS", "CNCGP",
];

export const TYPE_ACTE_LABELS = {
  reglement: "Reglement",
  directive: "Directive",
  decret: "Decret",
  arrete: "Arrete",
  instruction: "Instruction",
  position: "Position",
  recommandation: "Recommandation",
  ligne_directrice: "Ligne directrice",
  qa: "Questions-reponses (Q&A)",
  consultation: "Consultation",
  communique: "Communique",
  decision_sanction: "Decision de sanction",
};

export const DOMAINES = [
  "LCB-FT",
  "CIF / MiFID II",
  "DDA",
  "POG",
  "SFDR / durabilite",
  "RGPD",
  "protection_clientele",
  "demarchage",
  "IA / AI Act",
  "prudentiel",
  "fiscalite",
];

export const DOMAINE_LABELS = {
  "LCB-FT": "LCB-FT",
  "CIF / MiFID II": "CIF / MiFID II",
  "DDA": "DDA",
  "POG": "Gouvernance produits (POG)",
  "SFDR / durabilite": "SFDR / durabilite",
  "RGPD": "RGPD",
  "protection_clientele": "Protection de la clientele",
  "demarchage": "Demarchage",
  "IA / AI Act": "IA / AI Act",
  "prudentiel": "Prudentiel",
  "fiscalite": "Fiscalite",
};

export const PERIMETRES = [
  "CIF", "COA", "France", "Luxembourg", "FIC", "assurance-vie", "mandataires MIA",
];

export const PRIORITE_LABELS = { eleve: "Eleve", moyen: "Moyen", faible: "Faible" };
export const PRIORITE_ORDER = { eleve: 0, moyen: 1, faible: 2 };

export const STATUT_LABELS = {
  a_analyser: "A analyser",
  en_cours: "En cours",
  traite: "Traite",
  sans_impact: "Sans impact",
};

export const DATA_URL = "./veille.json";
