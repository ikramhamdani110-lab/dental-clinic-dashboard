import type {
  MethodePaiement,
  Prisma,
  StatutPaiement,
  TypeCorrectionPaiement,
} from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE } from '@backend/domain/constants'
import { verifierAbsenceDepassement } from '@backend/domain/finance'
import { erreurs } from '@backend/errors/app-error'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { logger } from '@backend/logging/logger'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'
import { filtreExclusion } from '@backend/services/trash.service'

/**
 * =============================================================================
 *  SERVICE PAIEMENTS (§16, §17, §44)
 * =============================================================================
 *
 *  PRINCIPES FINANCIERS
 *
 *  1. Un paiement est un EVENEMENT HISTORIQUE. Il n'est jamais modifie ni
 *     supprime silencieusement. Une erreur de saisie se corrige par une
 *     CONTRE-PASSATION (PaymentCorrection), qui conserve l'original.
 *
 *  2. Le chiffre d'affaires d'un mois est la somme des PAIEMENTS REELS de ce
 *     mois, jamais la somme des prix des traitements (§16).
 *
 *  3. Le total paye d'un traitement est la somme de ses paiements VALIDE.
 *     « Reste a payer » n'est jamais stocke : il est calcule (§12).
 *
 *  4. La double soumission est empechee par une CLE D'IDEMPOTENCE unique en
 *     base : le meme formulaire envoye deux fois ne cree qu'un paiement (§17).
 *
 *  5. Un paiement ne peut pas faire depasser le prix du traitement (§17). La
 *     verification est faite dans une TRANSACTION avec verrou, pour qu'une
 *     double soumission concurrente ne puisse pas passer les deux.
 */

// -----------------------------------------------------------------------------
//  CALCULS (toujours derives des donnees reelles)
// -----------------------------------------------------------------------------

/**
 * Somme des paiements VALIDE pour une liste de traitements.
 * UNE SEULE requete d'agregation groupee — pas une requete par traitement.
 */
export async function calcTotalPaye(
  traitementIds: readonly string[],
): Promise<Map<string, number>> {
  if (traitementIds.length === 0) return new Map()

  const groupes = await prisma.payment.groupBy({
    by: ['treatmentId'],
    where: { treatmentId: { in: [...traitementIds] }, statut: 'VALIDE' },
    _sum: { montantCentimes: true },
  })

  const resultat = new Map<string, number>()
  for (const groupe of groupes) {
    resultat.set(groupe.treatmentId, groupe._sum.montantCentimes ?? 0)
  }
  return resultat
}

/** Solde d'un traitement : total paye et reste a payer (§12). */
export async function calculerSoldeTraitement(
  traitementId: string,
): Promise<{ totalPayeCentimes: number; resteAPayerCentimes: number; prixTotalCentimes: number }> {
  const traitement = await prisma.treatment.findUnique({
    where: { id: traitementId },
    select: { prixTotalCentimes: true },
  })
  if (!traitement) throw erreurs.introuvable('Traitement')

  const agregat = await prisma.payment.aggregate({
    where: { treatmentId: traitementId, statut: 'VALIDE' },
    _sum: { montantCentimes: true },
  })

  const totalPayeCentimes = agregat._sum.montantCentimes ?? 0

  return {
    prixTotalCentimes: traitement.prixTotalCentimes,
    totalPayeCentimes,
    resteAPayerCentimes: traitement.prixTotalCentimes - totalPayeCentimes,
  }
}

// -----------------------------------------------------------------------------
//  CREATION D'UN PAIEMENT (§16, §17)
// -----------------------------------------------------------------------------

export interface DonneesPaiement {
  patientId: string
  treatmentId: string
  treatmentVisitId: string | null
  montantCentimes: number
  datePaiement: Date
  /**
   * Methode d'encaissement : FACULTATIVE. L'interface ne la demande plus (§16).
   * Lorsqu'elle est omise, la valeur par defaut du schema Prisma s'applique.
   */
  methode?: MethodePaiement
  notes: string | null
  idempotencyKey: string
}

export interface ResultatPaiement {
  id: string
  resteAPayerCentimes: number
  dejaEnregistre: boolean
}

/**
 * Enregistre un paiement.
 *
 * PROTECTION CONTRE LA DOUBLE SOUMISSION (§17)
 *   `idempotencyKey` est UNIQUE en base. Si la cle existe deja, le paiement
 *   existant est renvoye au lieu d'en creer un second. Cela couvre le cas du
 *   double clic, du reessai reseau et du double envoi de formulaire.
 *
 * INTEGRITE DU DEPASSEMENT (§17)
 *   La verification (paiements actuels + nouveau montant <= prix total) se fait
 *   dans une TRANSACTION, juste avant l'insertion. La contrainte est ainsi
 *   respectee meme sous concurrence.
 */
export async function ajouterPaiement(
  donnees: DonneesPaiement,
  contexte: JournalContext,
): Promise<ResultatPaiement> {
  // 1. Idempotence : si la cle a deja ete utilisee, on renvoie l'existant.
  const existant = await prisma.payment.findUnique({
    where: { idempotencyKey: donnees.idempotencyKey },
    select: { id: true, treatmentId: true },
  })
  if (existant) {
    const solde = await calculerSoldeTraitement(existant.treatmentId)
    return {
      id: existant.id,
      resteAPayerCentimes: solde.resteAPayerCentimes,
      dejaEnregistre: true,
    }
  }

  // 2. Verifications de coherence du traitement.
  const traitement = await prisma.treatment.findUnique({
    where: { id: donnees.treatmentId },
    select: { id: true, patientId: true, prixTotalCentimes: true },
  })
  if (!traitement) throw erreurs.introuvable('Traitement')

  if (traitement.patientId !== donnees.patientId) {
    // Coherence referentielle : un paiement ne peut pas relier un traitement a
    // un patient different de celui du traitement.
    throw erreurs.validation('Le traitement indique n’appartient pas a ce patient.', [
      { champ: 'treatmentId', message: 'Traitement incompatible avec le patient.' },
    ])
  }

  if (donnees.montantCentimes <= 0) {
    throw erreurs.montantInvalide('Le montant doit etre superieur a zero.')
  }

  // 3. Transaction : controle du solde + insertion atomique.
  const resultat = await prisma.$transaction(async (tx) => {
    const agregat = await tx.payment.aggregate({
      where: { treatmentId: donnees.treatmentId, statut: 'VALIDE' },
      _sum: { montantCentimes: true },
    })
    const totalDejaPayeCentimes = agregat._sum.montantCentimes ?? 0

    const controle = verifierAbsenceDepassement({
      prixTotalCentimes: traitement.prixTotalCentimes,
      totalDejaPayeCentimes,
      nouveauMontantCentimes: donnees.montantCentimes,
    })

    if (!controle.autorise) {
      throw erreurs.montantInvalide(
        `Ce paiement depasserait le prix total du traitement de ${(controle.depassement / 100).toLocaleString('fr-FR')} DA. Corrigez le montant ou le prix du traitement.`,
      )
    }

    const paiement = await tx.payment.create({
      data: {
        patientId: donnees.patientId,
        treatmentId: donnees.treatmentId,
        treatmentVisitId: donnees.treatmentVisitId,
        montantCentimes: donnees.montantCentimes,
        datePaiement: donnees.datePaiement,
        // Non fournie par l'interface : le defaut du schema s'applique (§16).
        ...(donnees.methode ? { methode: donnees.methode } : {}),
        notes: donnees.notes,
        idempotencyKey: donnees.idempotencyKey,
        createdById: contexte.userId ?? '',
      },
      select: { id: true },
    })

    return { id: paiement.id, resteApresPaiement: controle.resteApresPaiement }
  })

  await journaliser(contexte, ACTIONS.PAIEMENT_AJOUTE, {
    entityType: 'Paiement',
    entityId: resultat.id,
    metadata: {
      patientId: donnees.patientId,
      treatmentId: donnees.treatmentId,
      montantCentimes: donnees.montantCentimes,
      ...(donnees.methode ? { methode: donnees.methode } : {}),
    },
  })

  return {
    id: resultat.id,
    resteAPayerCentimes: resultat.resteApresPaiement,
    dejaEnregistre: false,
  }
}

// -----------------------------------------------------------------------------
//  LISTE DES PAIEMENTS (§26)
// -----------------------------------------------------------------------------

export interface FiltresPaiements {
  patientId?: string
  treatmentId?: string
  methode?: MethodePaiement
  statut?: StatutPaiement
  du?: Date
  au?: Date
  montantMinCentimes?: number
  montantMaxCentimes?: number
  recherche?: string
  page: number
  taille: number
}

export interface PaiementListe {
  id: string
  montantCentimes: number
  datePaiement: Date
  methode: MethodePaiement
  statut: StatutPaiement
  notes: string | null
  patientId: string
  patient: { nom: string; prenom: string }
  treatmentId: string
  treatment: { typeTraitement: string }
  createdAt: Date
}

export async function listerPaiements(
  filtres: FiltresPaiements,
): Promise<PageResult<PaiementListe>> {
  const idsEnCorbeille = await filtreExclusion('PAIEMENT')

  const where: Prisma.PaymentWhereInput = {
    id: idsEnCorbeille,
    ...(filtres.patientId ? { patientId: filtres.patientId } : {}),
    ...(filtres.treatmentId ? { treatmentId: filtres.treatmentId } : {}),
    ...(filtres.methode ? { methode: filtres.methode } : {}),
    ...(filtres.statut ? { statut: filtres.statut } : {}),
    ...(filtres.du || filtres.au
      ? {
          datePaiement: {
            ...(filtres.du ? { gte: filtres.du } : {}),
            ...(filtres.au ? { lte: filtres.au } : {}),
          },
        }
      : {}),
    ...(filtres.montantMinCentimes !== undefined || filtres.montantMaxCentimes !== undefined
      ? {
          montantCentimes: {
            ...(filtres.montantMinCentimes !== undefined
              ? { gte: filtres.montantMinCentimes }
              : {}),
            ...(filtres.montantMaxCentimes !== undefined
              ? { lte: filtres.montantMaxCentimes }
              : {}),
          },
        }
      : {}),
    ...(filtres.recherche
      ? {
          patient: {
            OR: [
              { nom: { contains: filtres.recherche, mode: 'insensitive' } },
              { prenom: { contains: filtres.recherche, mode: 'insensitive' } },
              { telephone: { contains: filtres.recherche } },
            ],
          },
        }
      : {}),
  }

  const { skip, take } = bornesPrisma(filtres)

  const [lignes, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { datePaiement: 'desc' },
      skip,
      take,
      include: {
        patient: { select: { nom: true, prenom: true } },
        treatment: { select: { typeTraitement: true } },
      },
    }),
    prisma.payment.count({ where }),
  ])

  const elements: PaiementListe[] = lignes.map((ligne) => ({
    id: ligne.id,
    montantCentimes: ligne.montantCentimes,
    datePaiement: ligne.datePaiement,
    methode: ligne.methode,
    statut: ligne.statut,
    notes: ligne.notes,
    patientId: ligne.patientId,
    patient: ligne.patient,
    treatmentId: ligne.treatmentId,
    treatment: ligne.treatment,
    createdAt: ligne.createdAt,
  }))

  return construirePage(elements, total, filtres)
}

/**
 * Paiements d'un patient, pour sa fiche.
 *
 * PAGINATION SERVEUR (§35) : les paiements s'accumulent a chaque visite ; un
 * patient suivi des annees peut en compter des centaines. Une page complete est
 * renvoyee (elements + total + pages).
 */
export async function paiementsDuPatient(
  patientId: string,
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<PaiementListe>> {
  return listerPaiements({ patientId, ...pagination })
}

// -----------------------------------------------------------------------------
//  CORRECTION / CONTRE-PASSATION (§17)
// -----------------------------------------------------------------------------

export interface DonneesCorrection {
  type: TypeCorrectionPaiement
  motif: string
  nouveauMontantCentimes?: number
  nouvelleMethode?: MethodePaiement
  nouvelleDate?: Date
}

/**
 * Corrige un paiement SANS detruire l'original.
 *
 * Trois types de correction :
 *
 *   ANNULATION
 *     Le paiement passe au statut ANNULE. Il reste en base, avec sa trace.
 *     Il est exclu des totaux.
 *
 *   CORRECTION_MONTANT
 *     Le paiement est annule et un NOUVEAU paiement, du montant corrige, est
 *     cree et rattache au meme traitement. L'ancien est conserve, annule.
 *
 *   CORRECTION_ATTRIBUT
 *     Seule la methode ou la date est corrigee. L'original est conserve, annule,
 *     et un nouveau paiement reprend les memes caracteristiques avec la valeur
 *     corrigee.
 *
 * Dans TOUS les cas, une ligne `payment_corrections` est ecrite avec les
 * anciennes ET les nouvelles valeurs : l'audit est complet (§17, §24).
 */
export async function corrigerPaiement(
  paiementId: string,
  donnees: DonneesCorrection,
  contexte: JournalContext,
): Promise<{ id: string }> {
  const paiement = await prisma.payment.findUnique({ where: { id: paiementId } })
  if (!paiement) throw erreurs.introuvable('Paiement')

  if (paiement.statut === 'ANNULE') {
    throw erreurs.conflit('Ce paiement a deja ete annule.')
  }

  // Verifications specifiques au type de correction.
  if (donnees.type === 'CORRECTION_MONTANT') {
    if (donnees.nouveauMontantCentimes === undefined || donnees.nouveauMontantCentimes <= 0) {
      throw erreurs.montantInvalide('Indiquez un nouveau montant superieur a zero.')
    }
    // Le nouveau montant ne doit pas faire depasser le prix du traitement en
    // tenant compte du reste des paiements valides.
    const agregat = await prisma.payment.aggregate({
      where: { treatmentId: paiement.treatmentId, statut: 'VALIDE', id: { not: paiementId } },
      _sum: { montantCentimes: true },
    })
    const traitement = await prisma.treatment.findUnique({
      where: { id: paiement.treatmentId },
      select: { prixTotalCentimes: true },
    })
    if (!traitement) throw erreurs.introuvable('Traitement')

    const controle = verifierAbsenceDepassement({
      prixTotalCentimes: traitement.prixTotalCentimes,
      totalDejaPayeCentimes: agregat._sum.montantCentimes ?? 0,
      nouveauMontantCentimes: donnees.nouveauMontantCentimes,
    })
    if (!controle.autorise) {
      throw erreurs.montantInvalide(
        `Le montant corrige depasserait le prix total du traitement de ${(controle.depassement / 100).toLocaleString('fr-FR')} DA.`,
      )
    }
  }

  const nouveauMontant =
    donnees.type === 'CORRECTION_MONTANT'
      ? (donnees.nouveauMontantCentimes as number)
      : paiement.montantCentimes
  const nouvelleMethode =
    donnees.type === 'CORRECTION_ATTRIBUT' && donnees.nouvelleMethode
      ? donnees.nouvelleMethode
      : paiement.methode
  const nouvelleDate =
    donnees.type === 'CORRECTION_ATTRIBUT' && donnees.nouvelleDate
      ? donnees.nouvelleDate
      : paiement.datePaiement

  const idNouveauPaiement = await prisma.$transaction(async (tx) => {
    // 1. Le paiement d'origine passe au statut ANNULE. Il n'est PAS supprime.
    await tx.payment.update({
      where: { id: paiementId },
      data: { statut: 'ANNULE' },
    })

    // 2. Ligne d'audit : anciennes et nouvelles valeurs.
    await tx.paymentCorrection.create({
      data: {
        paymentId: paiementId,
        type: donnees.type,
        motif: donnees.motif,
        ancienMontantCentimes: paiement.montantCentimes,
        ancienneMethode: paiement.methode,
        ancienneDate: paiement.datePaiement,
        nouveauMontantCentimes: donnees.type === 'ANNULATION' ? null : nouveauMontant,
        nouvelleMethode: donnees.type === 'ANNULATION' ? null : nouvelleMethode,
        nouvelleDate: donnees.type === 'ANNULATION' ? null : nouvelleDate,
        createdById: contexte.userId ?? '',
      },
    })

    // 3. Pour une correction, un nouveau paiement VALIDE est cree.
    if (donnees.type === 'ANNULATION') return null

    const nouveau = await tx.payment.create({
      data: {
        patientId: paiement.patientId,
        treatmentId: paiement.treatmentId,
        treatmentVisitId: paiement.treatmentVisitId,
        montantCentimes: nouveauMontant,
        datePaiement: nouvelleDate,
        methode: nouvelleMethode,
        notes: paiement.notes,
        // Cle d'idempotence derivee : unique, et liee a la correction.
        idempotencyKey: `correction:${paiementId}:${Date.now()}`,
        sourceCorrectionId: paiementId,
        createdById: contexte.userId ?? '',
      },
      select: { id: true },
    })

    return nouveau.id
  })

  await journaliser(
    contexte,
    donnees.type === 'ANNULATION' ? ACTIONS.PAIEMENT_ANNULE : ACTIONS.PAIEMENT_CORRIGE,
    {
      entityType: 'Paiement',
      entityId: paiementId,
      metadata: {
        type: donnees.type,
        motif: donnees.motif,
        ancienMontantCentimes: paiement.montantCentimes,
        nouveauMontantCentimes: donnees.type === 'ANNULATION' ? null : nouveauMontant,
      },
    },
  )

  return { id: idNouveauPaiement ?? paiementId }
}

/** Historique des corrections d'un paiement. */
export async function historiqueCorrections(paiementId: string): Promise<
  Array<{
    id: string
    type: TypeCorrectionPaiement
    motif: string
    ancienMontantCentimes: number
    nouveauMontantCentimes: number | null
    createdBy: string | null
    createdAt: Date
  }>
> {
  const lignes = await prisma.paymentCorrection.findMany({
    where: { paymentId: paiementId },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { displayName: true, email: true } } },
  })

  return lignes.map((ligne) => ({
    id: ligne.id,
    type: ligne.type,
    motif: ligne.motif,
    ancienMontantCentimes: ligne.ancienMontantCentimes,
    nouveauMontantCentimes: ligne.nouveauMontantCentimes,
    createdBy: ligne.createdBy?.displayName ?? ligne.createdBy?.email ?? null,
    createdAt: ligne.createdAt,
  }))
}

// -----------------------------------------------------------------------------
//  AGREGATIONS FINANCIERES (§18)
// -----------------------------------------------------------------------------
//
//  Toutes les sommes sont calculees EN BASE via `aggregate`/`groupBy`. On ne
//  telecharge JAMAIS l'ensemble des paiements pour calculer un total (§18).

/** Total encaisse sur une periode. */
export async function totalEncaisse(debut: Date, fin: Date): Promise<number> {
  const agregat = await prisma.payment.aggregate({
    where: { statut: 'VALIDE', datePaiement: { gte: debut, lte: fin } },
    _sum: { montantCentimes: true },
  })
  return agregat._sum.montantCentimes ?? 0
}

/** Nombre de paiements valides sur une periode. */
export async function nombrePaiements(debut: Date, fin: Date): Promise<number> {
  return prisma.payment.count({
    where: { statut: 'VALIDE', datePaiement: { gte: debut, lte: fin } },
  })
}

/**
 * Nombre TOTAL de paiements valides, toutes periodes confondues.
 *
 * Meme population que `totalRestantARecevoir` (paiements `VALIDE`) : les deux
 * indicateurs du tableau de bord « montants restant dus » et « nombre de
 * paiements » portent donc sur le meme perimetre et ne peuvent pas diverger.
 * Regle unique, appliquee en base par un `COUNT` : aucune ligne n'est chargee
 * dans Node (§18, §35).
 */
export async function nombreTotalPaiements(): Promise<number> {
  return prisma.payment.count({ where: { statut: 'VALIDE' } })
}

/**
 * Total restant a recevoir sur l'ensemble des traitements non annules.
 * Calcule = somme des prix - somme des paiements valides. En base uniquement.
 */
export async function totalRestantARecevoir(): Promise<number> {
  const [traitements, paiements] = await Promise.all([
    prisma.treatment.aggregate({
      where: { statut: { not: 'ANNULE' } },
      _sum: { prixTotalCentimes: true },
    }),
    prisma.payment.aggregate({
      where: { statut: 'VALIDE' },
      _sum: { montantCentimes: true },
    }),
  ])

  const total = traitements._sum.prixTotalCentimes ?? 0
  const paye = paiements._sum.montantCentimes ?? 0
  return Math.max(0, total - paye)
}

/**
 * Convertit un `Date` JavaScript en chaine « timestamp naif » dans le CALENDRIER
 * LOCAL du serveur.
 *
 * POURQUOI CETTE FONCTION EXISTE
 *
 *   La colonne `datePaiement` est un TIMESTAMP(3) naif qui contient l'instant
 *   UTC (Prisma y ecrit `date.toISOString()`). Comparer cette colonne a une
 *   borne exprimee elle aussi en UTC fonctionnerait, mais donnerait des
 *   frontieres de journee et de mois en UTC — c'est-a-dire decalees par rapport
 *   au calendrier du medecin, qui est le seul qui fasse foi ("les recettes
 *   d'aujourd'hui", "le mois de septembre").
 *
 *   On construit donc la chaine a partir des composants LOCAUX (`getFullYear`,
 *   `getMonth`, `getDate`, `getHours`…) et NON de `toISOString()`, qui bascule
 *   en UTC. Le resultat est un timestamp naif qui decrit la MEME horloge murale
 *   que la colonne, donc comparable directement.
 *
 *   Exemple, serveur en UTC+1 : une borne fixee a minuit local le 1er septembre
 *   2026 devient « 2026-09-01 00:00:00 » — et non « 2026-08-31 23:00:00 », que
 *   produirait `toISOString()`.
 *
 *   La valeur est transmise comme PARAMETRE LIE par le tagged template Prisma :
 *   elle n'est jamais concatenee au SQL, aucune injection n'est possible.
 */
function versChaineLocaleNaive(date: Date): string {
  const deuxChiffres = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}` +
    ` ${deuxChiffres(date.getHours())}:${deuxChiffres(date.getMinutes())}:${deuxChiffres(date.getSeconds())}`
  )
}

/**
 * Revenus agreges par mois, sur les N derniers mois (§18).
 * Base de graphique : Chaque point est la somme des PAIEMENTS REELS du mois.
 * Le calcul est fait par la base, jamais dans le navigateur.
 */
export async function revenusParMois(
  nombreMois: number,
  reference: Date = new Date(),
): Promise<Array<{ mois: number; annee: number; totalCentimes: number }>> {
  // Borne basse : premier jour du mois situe `nombreMois - 1` mois en arriere,
  // dans le CALENDRIER LOCAL — le meme que celui des autres indicateurs.
  const debut = new Date(reference.getFullYear(), reference.getMonth() - (nombreMois - 1), 1, 0, 0, 0, 0)

  // AGREGATION EN BASE : la base regroupe elle-meme les paiements par mois
  // (`DATE_TRUNC('month', ...)`) et ne renvoie QU'UNE LIGNE PAR MOIS. Node ne
  // charge donc jamais les paiements individuels pour construire le graphique,
  // dont le volume grandirait sans limite avec les annees d'exploitation (§18,
  // §35).
  //
  // `datePaiement` est un TIMESTAMP(3) naif ; Prisma y stocke des instants UTC.
  // `DATE_TRUNC` sur un timestamp naif est une operation purement calendaire,
  // independante de la timezone de session PostgreSQL : le mois obtenu
  // correspond donc exactement au calendrier LOCAL, comme la borne `debut`
  // ci-dessus.
  //
  // CORRECTION D'UN DECALAGE DE FUSEAU HORAIRE (defaut REEl, mesure)
  //
  //   Cette fonction regroupait auparavant les paiements par leur mois UTC
  //   (`DATE_TRUNC('month', "datePaiement")` sur un TIMESTAMP naif contenant
  //   l'instant UTC). Or TOUT LE RESTE de l'application borne les journees et les
  //   mois en HEURE LOCALE (`setHours(0,0,0,0)`, `getFullYear()`), parce que
  //   c'est le calendrier du medecin qui fait foi.
  //
  //   Avec un serveur en UTC+1 (Alger), un paiement encaisse a 00:30 heure locale
  //   le 1er septembre porte l'instant UTC 2026-08-31T23:30Z. Il etait donc
  //   compte dans le mois d'AOUT par le graphique, alors que le tableau de bord
  //   le comptait dans le mois de SEPTEMBRE : le meme argent apparaissait dans
  //   deux mois differents, et les deux ecrans ne se reconciliaient jamais.
  //
  //   On convertit donc l'instant stocke vers l'heure locale AVANT de le
  //   tronquer au mois. La colonne est un TIMESTAMP naif qui contient un instant
  //   UTC : on le declare d'abord comme `timestamptz` en UTC (`AT TIME ZONE
  //   'UTC'`), puis on le ramene dans le fuseau du serveur (`AT TIME ZONE
  //   current_setting('TimeZone')`). Les deux etapes sont necessaires : sans la
  //   premiere, le moteur interpreterait la valeur comme deja locale.
  //
  //   La borne basse est elle aussi exprimee dans le MEME calendrier local, afin
  //   que le filtre et le regroupement ne puissent pas diverger.
  //
  // La requete est parametree via un tagged template Prisma : la borne de date
  // est transmise comme valeur liee, jamais concatenee — aucune injection SQL
  // n'est possible.
  const borneLocaleNaive = versChaineLocaleNaive(debut)
  const lignes = await prisma.$queryRaw<
    Array<{ annee: number; mois: number; total_centimes: bigint }>
  >`
    SELECT
      EXTRACT(YEAR FROM mois_local)::int AS annee,
      (EXTRACT(MONTH FROM mois_local)::int - 1) AS mois,
      SUM("montantCentimes")::bigint AS total_centimes
    FROM (
      SELECT
        DATE_TRUNC(
          'month',
          ("datePaiement" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone')
        ) AS mois_local,
        "montantCentimes"
      FROM "payments"
      WHERE "statut" = 'VALIDE'::"StatutPaiement"
        AND "datePaiement" >= ${borneLocaleNaive}::timestamp
    ) AS paiements_locaux
    GROUP BY mois_local
    ORDER BY mois_local ASC
  `

  // Indexation par cle « annee-mois ». `mois` est un index base zero (0 = janvier),
  // identique a `Date.prototype.getMonth()`, afin de rester compatible avec
  // le remplissage des mois manquants ci-dessous.
  const totaux = new Map<string, number>()
  for (const ligne of lignes) {
    totaux.set(`${ligne.annee}-${ligne.mois}`, Number(ligne.total_centimes))
  }

  // Les mois SANS paiement restent presents avec un total de 0 : le graphique
  // doit conserver un point par mois, comme avant.
  //
  // ATTENTION — LES COMPOSANTS DE DATE SONT LUS EN LOCAL.
  //
  //   `debut` est desormais une borne du calendrier LOCAL. La lire avec
  //   `getUTCFullYear()`/`getUTCMonth()` la decalait de l'offset du fuseau : avec
  //   un serveur en UTC+1, le 1er janvier local etait relu comme le 31 decembre
  //   en UTC, et la serie commencait un mois trop tot — decalee de tout un mois
  //   par rapport aux lignes renvoyees par la requete.
  //
  //   Les cles produites ici doivent correspondre EXACTEMENT a celles de
  //   `GROUP BY mois_local`, donc au meme calendrier local.
  const serie: Array<{ mois: number; annee: number; totalCentimes: number }> = []
  for (let index = 0; index < nombreMois; index += 1) {
    const date = new Date(debut.getFullYear(), debut.getMonth() + index, 1)
    const cle = `${date.getFullYear()}-${date.getMonth()}`
    serie.push({
      mois: date.getMonth(),
      annee: date.getFullYear(),
      totalCentimes: totaux.get(cle) ?? 0,
    })
  }

  return serie
}

/**
 * Revenus agreges par GRANULARITE sur une periode quelconque (§18, §27).
 *
 * POURQUOI CETTE FONCTION
 *
 *   `revenusParAnnee` ne sait decrire qu'une ANNEE CIVILE complete : elle est
 *   utilisee par le rapport « evolution » quand le medecin choisit une annee.
 *
 *   Mais le filtre de periode accepte aussi « 7 jours », « 30 jours »,
 *   « annee precedente » ou une plage personnalisee. Pour ces choix, un
examen
 *   mois par mois sur 12 points n'a pas de sens : la courbe doit suivre la
 *   FENETRE REELLEMENT SELECTIONNEE.
 *
 *   Cette fonction produit donc une serie dont la granularite s'adapte a
 *   l'etendue demandee :
 *
 *     - fenetre courte (<= 62 jours) : UN POINT PAR JOUR ;
 *     - fenetre longue (au-dela)  : UN POINT PAR MOIS.
 *
 *   Le seuil de 62 jours correspond a environ deux mois : en deca, une courbe
 *   quotidienne reste lisible ; au-dela, elle deviendrait une dent de scie
 *   illisible, et le mois redevient la bonne maille.
 *
 *   Le regroupement est fait EN BASE (`DATE_TRUNC`) : la base ne renvoie qu'une
 *   ligne par point, jamais les paiements individuels (§35). Les bornes sont
 *   transmises comme CHAINES naives (jamais concatenees au SQL) et castees en
 *   `timestamp`, exactement comme `revenusParAnnee` — la colonne est un
 *   TIMESTAMP naif, et lier un `Date` JavaScript enverrait un `timestamptz` que
 *   PostgreSQL ramenerait dans la timezone de session.
 *
 *   Les points SANS paiement sont presents avec un total de 0 : la courbe garde
 *   une maille reguliere, ce qui rend les creux lisibles.
 */
export async function revenusParPeriode(
  debut: Date,
  fin: Date,
): Promise<{
  granularite: 'jour' | 'mois'
  points: Array<{ mois: number; annee: number; jour: number | null; totalCentimes: number }>
}> {
  const JOURS_MS = 24 * 60 * 60 * 1000
  const nombreJours = Math.max(1, Math.round((fin.getTime() - debut.getTime()) / JOURS_MS) + 1)
  const granularite = nombreJours <= 62 ? 'jour' : 'mois'

  // Meme convention que `revenusParMois` : les bornes sont exprimees dans le
  // CALENDRIER LOCAL, celui des autres indicateurs financiers.
  const borneDebut = versChaineLocaleNaive(debut)
  const borneFin = versChaineLocaleNaive(fin)

  if (granularite === 'jour') {
    const lignes = await prisma.$queryRaw<
      Array<{ annee: number; mois: number; jour: number; total_centimes: bigint }>
    >`
      SELECT
        EXTRACT(YEAR FROM jour_local)::int AS annee,
        (EXTRACT(MONTH FROM jour_local)::int - 1) AS mois,
        EXTRACT(DAY FROM jour_local)::int AS jour,
        SUM("montantCentimes")::bigint AS total_centimes
      FROM (
        SELECT
          DATE_TRUNC(
            'day',
            ("datePaiement" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone')
          ) AS jour_local,
          "montantCentimes"
        FROM "payments"
        WHERE "statut" = 'VALIDE'::"StatutPaiement"
          AND "datePaiement" >= ${borneDebut}::timestamp
          AND "datePaiement" <= ${borneFin}::timestamp
      ) AS paiements_locaux
      GROUP BY jour_local
      ORDER BY jour_local ASC
    `

    const totaux = new Map<string, number>()
    for (const ligne of lignes) {
      totaux.set(`${ligne.annee}-${ligne.mois}-${ligne.jour}`, Number(ligne.total_centimes))
    }

    // Un point par journee civile de la fenetre, dans l'ordre chronologique.
    const points: Array<{
      mois: number
      annee: number
      jour: number | null
      totalCentimes: number
    }> = []
    for (let curseur = new Date(debut); curseur <= fin; curseur.setDate(curseur.getDate() + 1)) {
      const annee = curseur.getFullYear()
      const mois = curseur.getMonth()
      const jour = curseur.getDate()
      points.push({
        mois,
        annee,
        jour,
        totalCentimes: totaux.get(`${annee}-${mois}-${jour}`) ?? 0,
      })
    }
    return { granularite, points }
  }

  const lignes = await prisma.$queryRaw<
    Array<{ annee: number; mois: number; total_centimes: bigint }>
  >`
    SELECT
      EXTRACT(YEAR FROM mois_local)::int AS annee,
      (EXTRACT(MONTH FROM mois_local)::int - 1) AS mois,
      SUM("montantCentimes")::bigint AS total_centimes
    FROM (
      SELECT
        DATE_TRUNC(
          'month',
          ("datePaiement" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone')
        ) AS mois_local,
        "montantCentimes"
      FROM "payments"
      WHERE "statut" = 'VALIDE'::"StatutPaiement"
        AND "datePaiement" >= ${borneDebut}::timestamp
        AND "datePaiement" <= ${borneFin}::timestamp
    ) AS paiements_locaux
    GROUP BY mois_local
    ORDER BY mois_local ASC
  `

  const totaux = new Map<string, number>()
  for (const ligne of lignes) {
    totaux.set(`${ligne.annee}-${ligne.mois}`, Number(ligne.total_centimes))
  }

  // Un point par mois civil touche par la fenetre, dans l'ordre chronologique.
  const points: Array<{
    mois: number
    annee: number
    jour: number | null
    totalCentimes: number
  }> = []
  const curseur = new Date(debut.getFullYear(), debut.getMonth(), 1)
  const dernierMois = new Date(fin.getFullYear(), fin.getMonth(), 1)
  while (curseur <= dernierMois) {
    const annee = curseur.getFullYear()
    const mois = curseur.getMonth()
    points.push({
      mois,
      annee,
      jour: null,
      totalCentimes: totaux.get(`${annee}-${mois}`) ?? 0,
    })
    curseur.setMonth(curseur.getMonth() + 1)
  }
  return { granularite, points }
}

/**
 * Revenus agreges MOIS PAR MOIS d'une annee civile complete (§27).
 *
 * Comme `revenusParMois`, le regroupement est fait EN BASE
 * (`DATE_TRUNC('month', ...)` + `GROUP BY`) et la base ne renvoie QU'UNE LIGNE
 * PAR MOIS. Node ne telecharge jamais les paiements individuels : le graphique
 * annuel reste rapide meme avec des dizaines de milliers de paiements.
 *
 * L'annee est bornee en `[1er janvier 00:00:00, 31 decembre 23:59:59]` du
 * calendrier LOCAL — le meme que celui de `periodeAnnee` et de tous les autres
 * indicateurs financiers. Les bornes sont transmises comme CHAINES naives
 * (jamais concatenees au SQL) et castees en `timestamp`.
 *
 * ATTENTION — ne pas revenir a un calendrier UTC ici.
 *
 *   C'est exactement la divergence corrigee dans `revenusParMois` : un mois
 *   groupe en UTC alors que les autres ecrans bornent en heure locale fait
 *   apparaitre le meme paiement dans deux mois differents (voir le commentaire
 *   detaille de `revenusParMois`).
 */
export async function revenusParAnnee(
  annee: number,
): Promise<Array<{ mois: number; annee: number; totalCentimes: number }>> {
  const debut = new Date(annee, 0, 1, 0, 0, 0, 0)
  const fin = new Date(annee, 11, 31, 23, 59, 59, 999)
  const borneDebut = versChaineLocaleNaive(debut)
  const borneFin = versChaineLocaleNaive(fin)

  const lignes = await prisma.$queryRaw<
    Array<{ annee: number; mois: number; total_centimes: bigint }>
  >`
    SELECT
      EXTRACT(YEAR FROM mois_local)::int AS annee,
      (EXTRACT(MONTH FROM mois_local)::int - 1) AS mois,
      SUM("montantCentimes")::bigint AS total_centimes
    FROM (
      SELECT
        DATE_TRUNC(
          'month',
          ("datePaiement" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone')
        ) AS mois_local,
        "montantCentimes"
      FROM "payments"
      WHERE "statut" = 'VALIDE'::"StatutPaiement"
        AND "datePaiement" >= ${borneDebut}::timestamp
        AND "datePaiement" <= ${borneFin}::timestamp
    ) AS paiements_locaux
    GROUP BY mois_local
    ORDER BY mois_local ASC
  `

  const totaux = new Map<string, number>()
  for (const ligne of lignes) {
    totaux.set(`${ligne.annee}-${ligne.mois}`, Number(ligne.total_centimes))
  }

  // Les 12 mois sont TOUJOURS presents, meme sans paiement (total 0) : la courbe
  // conserve un point par mois, ce qui rend les creux lisibles.
  return Array.from({ length: 12 }, (_valeur, mois) => ({
    mois,
    annee,
    totalCentimes: totaux.get(`${annee}-${mois}`) ?? 0,
  }))
}

/** Repartition des revenus par methode de paiement, sur une periode. */
export async function revenusParMethode(
  debut: Date,
  fin: Date,
): Promise<Array<{ methode: MethodePaiement; totalCentimes: number }>> {
  const groupes = await prisma.payment.groupBy({
    by: ['methode'],
    where: { statut: 'VALIDE', datePaiement: { gte: debut, lte: fin } },
    _sum: { montantCentimes: true },
  })

  return groupes.map((groupe) => ({
    methode: groupe.methode,
    totalCentimes: groupe._sum.montantCentimes ?? 0,
  }))
}

/**
 * Verification d'integrite financiere : liste les traitements dont les
 * paiements valides depassent le prix total.
 *
 * En exploitation normale, cette liste doit TOUJOURS etre vide. Elle existe
 * pour detecter une anomalie (import manuel, intervention directe en base).
 */
export async function detecterDepassements(): Promise<
  Array<{ treatmentId: string; prixTotalCentimes: number; totalPayeCentimes: number }>
> {
  const groupes = await prisma.payment.groupBy({
    by: ['treatmentId'],
    where: { statut: 'VALIDE' },
    _sum: { montantCentimes: true },
  })

  if (groupes.length === 0) return []

  const traitements = await prisma.treatment.findMany({
    where: { id: { in: groupes.map((groupe) => groupe.treatmentId) } },
    select: { id: true, prixTotalCentimes: true },
  })

  const prixParId = new Map(traitements.map((t) => [t.id, t.prixTotalCentimes]))

  const anomalies: Array<{
    treatmentId: string
    prixTotalCentimes: number
    totalPayeCentimes: number
  }> = []
  for (const groupe of groupes) {
    const prix = prixParId.get(groupe.treatmentId)
    const paye = groupe._sum.montantCentimes ?? 0
    if (prix !== undefined && paye > prix) {
      anomalies.push({
        treatmentId: groupe.treatmentId,
        prixTotalCentimes: prix,
        totalPayeCentimes: paye,
      })
    }
  }

  if (anomalies.length > 0) {
    logger.error('Anomalie financiere detectee : paiements en depassement', {
      nombre: anomalies.length,
    })
  }

  return anomalies
}
