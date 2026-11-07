/**
 * =============================================================================
 *  CONTRATS DU SITE FINANCIER — MIROIR DES ROUTES API
 * =============================================================================
 *
 *  Ces types décrivent EXACTEMENT ce que renvoient `/api/finances/*`. Aucun
 *  champ n'est supposé : si le serveur ne l'envoie pas, il n'existe pas ici.
 *
 *  Aucun champ « méthode de paiement » n'y figure — le moyen d'encaissement
 *  ne doit apparaître nulle part dans l'interface.
 */

/** Réponse de `/api/finances/summary` — les TROIS boîtes et le solde net. */
export interface Synthese {
  periode: { debut: string; fin: string }
  /** BOÎTE 1 — argent réellement reçu (paiements du secrétariat). */
  revenusCentimes: number
  nombrePaiements: number
  /** Ancienne source, hors boîte : jamais additionnée aux revenus reçus. */
  revenusManuelsCentimes: number
  /** BOÎTE 3 — dépenses saisies par le médecin. */
  depensesCentimes: number
  nombreDepenses: number
  /** Dette GLOBALE des patients — BOÎTE 2. Jamais dans le solde net. */
  restantDuCentimes: number
  nombrePatientsDebiteurs: number
  /** revenus − dépenses. */
  soldeNetCentimes: number
  mention: string
  revenusMoisCentimes: number
  nombrePaiementsMois: number
}

export interface LignePaiement {
  id: string
  patient: string
  montantCentimes: number
  date: string
  description: string | null
  statutPaiement: 'VALIDE'
}

export interface ReponsePaiements {
  elements: LignePaiement[]
  total: number
  totalCentimes: number
  page: number
  pages: number
  taille: number
}

export interface LigneDette {
  patientId: string
  patient: string
  telephone: string
  resteAPayerCentimes: number
  traitement: string | null
  rendezVous: string | null
  /** Montant total facturé au patient (traitements non annulés). */
  totalDuCentimes: number
  /** Montant déjà encaissé (paiements validés). */
  payeCentimes: number
  /** Date du dernier paiement validé, `null` si le patient n'a jamais payé. */
  dernierPaiement: string | null
  statutPaiement: 'NON_PAYE' | 'PARTIEL'
}

export interface ReponseDettes {
  elements: LigneDette[]
  total: number
  totalCentimes: number
  page: number
  pages: number
  taille: number
}

export interface LigneDepense {
  id: string
  titre: string
  montantCentimes: number
  date: string
  categorie: string
  createdAt: string
  updatedAt: string
}

export interface ReponseDepenses {
  elements: LigneDepense[]
  total: number
  page: number
  pages: number
  taille: number
  categories: string[]
}

export interface DetailPaiement {
  id: string
  patient: string
  telephone: string | null
  datePaiement: string
  montantCentimes: number
  statut: 'VALIDE' | 'ANNULE'
  notes: string | null
  rendezVous: { id: string; dateDebut: string; dateFin: string; statut: string } | null
  traitement: {
    id: string
    type: string
    statut: string
    dents: string
    prixTotalCentimes: number
    payeCentimes: number
    restantCentimes: number
  } | null
  patientTotalDuCentimes: number
  patientPayeCentimes: number
  patientRestantCentimes: number
}

export type Periode =
  | '7-jours'
  | '30-jours'
  | 'mois'
  | 'trimestre'
  | 'annee'
  | 'annee-precedente'
  | 'personnalisee'

export interface FiltresPeriode {
  periode: Periode
  /** Année du sélecteur — utilisée par la période « Cette année ». */
  annee: number
  /** Bornes ISO (aaaa-mm-jj) de la période personnalisée. */
  du: string
  au: string
}

const ANNEE_COURANTE = new Date().getFullYear()

export const FILTRES_DEFAUT: FiltresPeriode = {
  periode: '30-jours',
  annee: ANNEE_COURANTE,
  du: '',
  au: '',
}

/**
 * Paramètres réellement envoyés au serveur.
 *
 * « Personnalisé » n'est actif qu'avec deux bornes valides : tant que ce n'est
 * pas le cas, on interroge 30 jours plutôt que d'envoyer une plage incomplète,
 * que le serveur refuserait (validation) — l'écran resterait alors vide.
 */
export function parametresPeriode(filtres: FiltresPeriode): string {
  const p = new URLSearchParams()

  if (filtres.periode === 'personnalisee') {
    if (filtres.du && filtres.au && filtres.au >= filtres.du) {
      p.set('periode', 'personnalisee')
      p.set('du', filtres.du)
      p.set('au', filtres.au)
      return p.toString()
    }
    p.set('periode', '30-jours')
    return p.toString()
  }

  p.set('periode', filtres.periode)
  if (filtres.periode === 'annee') p.set('annee', String(filtres.annee))
  return p.toString()
}

/** Libellé de la fenêtre réellement interrogée (jamais le bouton cliqué). */
export function decrirePeriode(filtres: FiltresPeriode): string {
  switch (filtres.periode) {
    case '7-jours':
      return 'des 7 derniers jours'
    case '30-jours':
      return 'des 30 derniers jours'
    case 'mois':
      return 'du mois en cours'
    case 'trimestre':
      return 'du trimestre en cours'
    case 'annee':
      return `de l’exercice ${filtres.annee}`
    case 'annee-precedente':
      return `de l’exercice ${ANNEE_COURANTE - 1}`
    case 'personnalisee':
      return filtres.du && filtres.au && filtres.au >= filtres.du
        ? `du ${formaterDate(filtres.du)} au ${formaterDate(filtres.au)}`
        : 'des 30 derniers jours'
    default:
      return 'de la période courante'
  }
}

/** `2026-03-12` ou ISO complet → `12/03/2026`. */
export function formaterDate(iso: string): string {
  // Une date « nue » (aaaa-mm-jj) doit être lue en local, sinon un fuseau
  // négatif la ferait glisser d'un jour.
  const valeur = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso
  return new Date(valeur).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formaterDateHeure(date: Date): string {
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
