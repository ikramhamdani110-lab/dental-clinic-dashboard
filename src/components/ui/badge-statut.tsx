import { contenu, t } from '@content/index'

/**
 * =============================================================================
 *  BADGES DE STATUT (§5)
 * =============================================================================
 *
 *  Chaque statut est traduit en francais et associe a une couleur SOBRE :
 *    - vert   : etat positif ou finalise (Termine, Valide) ;
 *    - bleu   : etat normal en cours (Planifie, En cours)
 *    - ambre  : etat a surveiller (Reprogramme) ;
 *    - rouge  : etat negatif (Annule, Absent)
 *
 *  Le libelle texte est TOUJOURS present (jamais seulement une couleur) : la
 *  couleur seule serait inaccessible aux personnes daltoniennes.
 */

type TonBadge = 'neutre' | 'info' | 'succes' | 'avertissement' | 'erreur'

export const TONS_STATUT_RENDEZ_VOUS: Record<string, TonBadge> = {
  PLANIFIE: 'info',
  // Les valeurs d'organisation historiques sont toutes illustrees par le meme
  // bleu que PLANIFIE : « Confirme » se LIT « Planifie » (§2), donc il ne peut
  // pas porter une couleur differente — sinon un rendez-vous historique au
  // statut CONFIRME s'afficherait en vert alors que son libelle dit « Planifie ».
  // UNE SEULE couleur pour l'etat « planifie », quel que soit le code stocke.
  CONFIRME: 'info',
  EN_ATTENTE: 'info',
  EN_COURS: 'info',
  TERMINE: 'succes',
  ANNULE: 'erreur',
  ABSENT: 'erreur',
  REPROGRAMME: 'avertissement',
}

const TONS_STATUT_TRAITEMENT: Record<string, TonBadge> = {
  PLANIFIE: 'info',
  EN_COURS: 'info',
  TERMINE: 'succes',
  ANNULE: 'erreur',
}

const TONS_STATUT_PAIEMENT: Record<string, TonBadge> = {
  VALIDE: 'succes',
  ANNULE: 'erreur',
}

function Badge({ ton, texte }: { ton: TonBadge; texte: string }): React.JSX.Element {
  return <span className={`badge badge-${ton}`}>{texte}</span>
}

/** Statut d'un rendez-vous. */
export function BadgeStatutRendezVous({ statut }: { statut: string }): React.JSX.Element {
  const libelle =
    contenu.rendezVous.statuts[statut as keyof typeof contenu.rendezVous.statuts] ?? statut
  return <Badge ton={TONS_STATUT_RENDEZ_VOUS[statut] ?? 'neutre'} texte={libelle} />
}

/** Statut d'un traitement. */
export function BadgeStatutTraitement({ statut }: { statut: string }): React.JSX.Element {
  const libelle =
    contenu.traitements.statuts[statut as keyof typeof contenu.traitements.statuts] ?? statut
  return <Badge ton={TONS_STATUT_TRAITEMENT[statut] ?? 'neutre'} texte={libelle} />
}

/** Statut d'un paiement. */
export function BadgeStatutPaiement({ statut }: { statut: string }): React.JSX.Element {
  const libelle =
    contenu.paiements.statuts[statut as keyof typeof contenu.paiements.statuts] ?? statut
  return <Badge ton={TONS_STATUT_PAIEMENT[statut] ?? 'neutre'} texte={libelle} />
}

/** Badge indiquant un solde : paye (vert) ou restant (ambre). */
export function BadgeSolde({ resteCentimes }: { resteCentimes: number }): React.JSX.Element {
  if (resteCentimes <= 0) {
    return <Badge ton="succes" texte={t('paiements.solder')} />
  }
  return <Badge ton="avertissement" texte={t('traitements.resteAPayer')} />
}
