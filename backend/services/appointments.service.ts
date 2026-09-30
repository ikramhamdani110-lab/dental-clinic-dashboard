import type { Prisma, StatutRendezVous } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { calcTotalPaye } from '@backend/services/payments.service'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'
import { filtreExclusion } from '@backend/services/trash.service'
import { TYPES_TRAITEMENT_RENDEZ_VOUS } from '@backend/domain/constants'

/**
 * =============================================================================
 *  SERVICE RENDEZ-VOUS (§14, §15)
 * =============================================================================
 *
 *  Points cles :
 *    - Detection de conflit AVANT enregistrement : deux rendez-vous ne peuvent
 *      pas se chevaucher.
 *    - Reprogrammation : l'ANCIENNE date, l'ANCIENNE heure, la NOUVELLE date,
 *      la NOUVELLE heure, l'auteur et l'horodatage sont CONSERVES dans
 *      `appointment_reschedules`. Rien n'est ecrase (§15, §11).
 */

export interface FiltresRendezVous {
  dateDebut?: Date
  dateFin?: Date
  patientId?: string
  statut?: StatutRendezVous
  recherche?: string
  page: number
  taille: number
}

export interface RendezVousAvecPatient {
  id: string
  patientId: string
  patient: { nom: string; prenom: string; telephone: string }
  dateDebut: Date
  dateFin: Date
  dents: string[]
  motif: string | null
  notes: string | null
  statut: StatutRendezVous
  motifStatut: string | null
  treatmentId: string | null
  typeTraitement: string | null
  createdAt: Date
}

/**
 * Rendez-vous d'un patient, ENRICHI du traitement lie et de son solde.
 *
 * Ce champ n'existe QUE sur cette variante, utilisee par la seule fiche patient.
 * La liste generale des rendez-vous n'a pas besoin du solde d'un traitement, et
 * l'y imposer aurait casse le planning : le champ est donc propre a ce besoin.
 */
export interface PatientRendezVousDetaille extends RendezVousAvecPatient {
  /**
   * Traitement lie au rendez-vous, lorsqu'il existe, avec son solde.
   * `null` pour un rendez-vous sans traitement (controle, consultation simple) :
   * l'interface affiche alors un tiret plutot qu'un montant invente.
   */
  traitement: {
    id: string
    typeTraitement: string
    prixTotalCentimes: number
    montantPayeCentimes: number
    /** Calcule : prix total - paiements VALIDE. Jamais stocke (§12). */
    resteAPayerCentimes: number
    statut: string
  } | null
}

/** Analyse la liste de dents stockee en JSON (colonne TEXT). */
function parseDents(valeur: string): string[] {
  try {
    const analyse: unknown = JSON.parse(valeur)
    return Array.isArray(analyse) ? analyse.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

/**
 * Detection de conflit.
 *
 * Deux rendez-vous se chevauchent si :
 *   debutA < finB  ET  finA > debutB
 *
 * Les rendez-vous ANNULE et ABSENT ne bloquent pas un creneau : le patient ne
 * viendra pas, le creneau est libre.
 *
 * `exclureId` permet de verifier un rendez-vous en cours de modification sans
 * le detecter comme en conflit avec lui-meme.
 */
export async function detecterConflit(params: {
  dateDebut: Date
  dateFin: Date
  exclureId?: string
}): Promise<{
  enConflit: boolean
  rendezVous?: Array<{
    patient: string
    dateDebut: Date
    dateFin: Date
  }>
}> {
  const conflits = await prisma.appointment.findMany({
    where: {
      statut: { notIn: ['ANNULE', 'ABSENT'] },
      dateDebut: { lt: params.dateFin },
      dateFin: { gt: params.dateDebut },
      ...(params.exclureId ? { id: { not: params.exclureId } } : {}),
    },
    select: {
      dateDebut: true,
      dateFin: true,
      patient: { select: { nom: true, prenom: true } },
    },
    take: 5,
  })

  if (conflits.length === 0) return { enConflit: false }

  return {
    enConflit: true,
    rendezVous: conflits.map((conflit) => ({
      patient: `${conflit.patient.prenom} ${conflit.patient.nom}`,
      dateDebut: conflit.dateDebut,
      dateFin: conflit.dateFin,
    })),
  }
}

/** Formate le message de conflit en francais. */
export function messageConflit(
  rendezVous: Array<{ patient: string; dateDebut: Date; dateFin: Date }>,
): string {
  const heure = (date: Date) =>
    date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const premier = rendezVous[0]
  if (!premier) return 'Un rendez-vous existe deja sur ce creneau.'
  return `Un rendez-vous existe deja sur ce creneau : ${premier.patient} de ${heure(premier.dateDebut)} a ${heure(premier.dateFin)}.`
}

/** Liste paginee, filtree par periode / statut / recherche patient. */
export async function listerRendezVous(
  filtres: FiltresRendezVous,
): Promise<PageResult<RendezVousAvecPatient>> {
  const idsEnCorbeille = await filtreExclusion('RENDEZ_VOUS')

  const where: Prisma.AppointmentWhereInput = {
    id: idsEnCorbeille,
    ...(filtres.dateDebut || filtres.dateFin
      ? {
          dateDebut: {
            ...(filtres.dateDebut ? { gte: filtres.dateDebut } : {}),
            ...(filtres.dateFin ? { lte: filtres.dateFin } : {}),
          },
        }
      : {}),
    ...(filtres.patientId ? { patientId: filtres.patientId } : {}),
    ...(filtres.statut ? { statut: filtres.statut } : {}),
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
    prisma.appointment.findMany({
      where,
      orderBy: { dateDebut: 'asc' },
      skip,
      take,
      include: {
        patient: { select: { nom: true, prenom: true, telephone: true } },
        treatment: { select: { typeTraitement: true } },
      },
    }),
    prisma.appointment.count({ where }),
  ])

  const elements: RendezVousAvecPatient[] = lignes.map((ligne) => ({
    id: ligne.id,
    patientId: ligne.patientId,
    patient: ligne.patient,
    dateDebut: ligne.dateDebut,
    dateFin: ligne.dateFin,
    dents: parseDents(ligne.dents),
    motif: ligne.motif,
    notes: ligne.notes,
    statut: ligne.statut,
    motifStatut: ligne.motifStatut,
    treatmentId: ligne.treatmentId,
    typeTraitement: ligne.treatment?.typeTraitement ?? null,
    createdAt: ligne.createdAt,
  }))

  return construirePage(elements, total, filtres)
}

/** Rendez-vous d'une journee, tries par heure. */
export async function listerRendezVousJour(date: Date): Promise<RendezVousAvecPatient[]> {
  const debut = new Date(date)
  debut.setHours(0, 0, 0, 0)
  const fin = new Date(date)
  fin.setHours(23, 59, 59, 999)

  const resultat = await listerRendezVous({
    dateDebut: debut,
    dateFin: fin,
    page: 1,
    taille: 100,
  })
  return resultat.elements
}

/** Rendez-vous a venir, pour le tableau de bord. */
export async function prochainsRendezVous(limite = 5): Promise<RendezVousAvecPatient[]> {
  const idsEnCorbeille = await filtreExclusion('RENDEZ_VOUS')

  const lignes = await prisma.appointment.findMany({
    where: {
      id: idsEnCorbeille,
      dateDebut: { gte: new Date() },
      statut: { notIn: ['ANNULE', 'ABSENT'] },
    },
    orderBy: { dateDebut: 'asc' },
    take: limite,
    include: {
      patient: { select: { nom: true, prenom: true, telephone: true } },
      treatment: { select: { typeTraitement: true } },
    },
  })

  return lignes.map((ligne) => ({
    id: ligne.id,
    patientId: ligne.patientId,
    patient: ligne.patient,
    dateDebut: ligne.dateDebut,
    dateFin: ligne.dateFin,
    dents: parseDents(ligne.dents),
    motif: ligne.motif,
    notes: ligne.notes,
    statut: ligne.statut,
    motifStatut: ligne.motifStatut,
    treatmentId: ligne.treatmentId,
    typeTraitement: ligne.treatment?.typeTraitement ?? null,
    createdAt: ligne.createdAt,
  }))
}

export interface DonneesRendezVous {
  patientId: string
  dateDebut: Date
  dateFin: Date
  treatmentId: string | null
  dents: string[]
  motif: string | null
  notes: string | null
  statut: StatutRendezVous
}

/** Cree un rendez-vous apres verification de conflit. */
export async function creerRendezVous(
  donnees: DonneesRendezVous,
  contexte: JournalContext,
): Promise<{ id: string }> {
  const conflict = await detecterConflit({
    dateDebut: donnees.dateDebut,
    dateFin: donnees.dateFin,
  })
  if (conflict.enConflit && conflict.rendezVous) {
    throw erreurs.rendezVousEnConflit(messageConflit(conflict.rendezVous))
  }

  const rendezVous = await prisma.appointment.create({
    data: {
      patientId: donnees.patientId,
      dateDebut: donnees.dateDebut,
      dateFin: donnees.dateFin,
      treatmentId: donnees.treatmentId,
      dents: JSON.stringify(donnees.dents),
      motif: donnees.motif,
      notes: donnees.notes,
      statut: donnees.statut,
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.RENDEZ_VOUS_CREE, {
    entityType: 'RendezVous',
    entityId: rendezVous.id,
    metadata: { patientId: donnees.patientId, dateDebut: donnees.dateDebut.toISOString() },
  })

  return rendezVous
}

const DUREE_CRENEAU_NOUVEAU_MS = 30 * 60_000

export function premierCreneauDisponible(date: string, rendezVous: Array<{ dateDebut: Date; dateFin: Date }>): {
  dateDebut: Date
  dateFin: Date
} {
  const [annee, mois, jour] = date.split('-').map(Number)
  const debutJour = new Date(annee ?? 0, (mois ?? 1) - 1, jour ?? 1)
  const finJour = new Date(annee ?? 0, (mois ?? 1) - 1, (jour ?? 1) + 1)
  const aujourdhui = new Date()
  const premierDebut = new Date(debutJour)
  premierDebut.setHours(9, 0, 0, 0)
  if (debutJour.toDateString() === aujourdhui.toDateString()) {
    const prochainDemiCreneau = Math.ceil(aujourdhui.getTime() / DUREE_CRENEAU_NOUVEAU_MS) * DUREE_CRENEAU_NOUVEAU_MS
    if (prochainDemiCreneau > premierDebut.getTime()) premierDebut.setTime(prochainDemiCreneau)
  }

  const plages = rendezVous
    .filter((item) => item.dateFin > premierDebut && item.dateDebut < finJour)
    .sort((premier, suivant) => premier.dateDebut.getTime() - suivant.dateDebut.getTime())

  for (let debut = premierDebut.getTime(); debut + DUREE_CRENEAU_NOUVEAU_MS <= finJour.getTime(); debut += DUREE_CRENEAU_NOUVEAU_MS) {
    const fin = debut + DUREE_CRENEAU_NOUVEAU_MS
    if (!plages.some((plage) => plage.dateDebut.getTime() < fin && plage.dateFin.getTime() > debut)) {
      return { dateDebut: new Date(debut), dateFin: new Date(fin) }
    }
  }

  throw erreurs.validation('Aucun creneau disponible pour cette date.')
}

export async function creerRendezVousDepuisFormulaire(
  donnees: {
    patientId: string
    date: string
    typeTraitement: (typeof TYPES_TRAITEMENT_RENDEZ_VOUS)[number]
    totalCentimes: number
    payeCentimes: number
    notes: string | null
    idempotencyKey: string
  },
  contexte: JournalContext,
): Promise<{ id: string; traitementId: string; patientId: string; dejaEnregistre: boolean }> {
  const existing = await prisma.appointment.findUnique({
    where: { submissionKey: donnees.idempotencyKey },
    select: { id: true, patientId: true, treatmentId: true },
  })
  if (existing) {
    return {
      id: existing.id,
      patientId: existing.patientId,
      traitementId: existing.treatmentId ?? '',
      dejaEnregistre: true,
    }
  }

  const patient = await prisma.patient.findUnique({ where: { id: donnees.patientId }, select: { id: true } })
  if (!patient) throw erreurs.introuvable('Patient')

  const [annee, mois, jour] = donnees.date.split('-').map(Number)
  const debutJour = new Date(annee ?? 0, (mois ?? 1) - 1, jour ?? 1)
  const finJour = new Date(annee ?? 0, (mois ?? 1) - 1, (jour ?? 1) + 1)
  const plages = await prisma.appointment.findMany({
    where: {
      dateDebut: { lt: finJour },
      dateFin: { gt: debutJour },
      statut: { notIn: ['ANNULE', 'ABSENT'] },
    },
    select: { dateDebut: true, dateFin: true },
    orderBy: { dateDebut: 'asc' },
  })
  const slot = premierCreneauDisponible(donnees.date, plages)

  const created = await prisma.$transaction(async (tx) => {
    const treatment = await tx.treatment.create({
      data: {
        patientId: patient.id,
        typeTraitement: donnees.typeTraitement,
        prixTotalCentimes: donnees.totalCentimes,
        statut: 'PLANIFIE',
        dateDebut: slot.dateDebut,
        notes: donnees.notes,
      },
      select: { id: true },
    })

    const appointment = await tx.appointment.create({
      data: {
        patientId: patient.id,
        treatmentId: treatment.id,
        dateDebut: slot.dateDebut,
        dateFin: slot.dateFin,
        dents: JSON.stringify([]),
        motif: null,
        notes: donnees.notes,
        statut: 'PLANIFIE',
        submissionKey: donnees.idempotencyKey,
      },
      select: { id: true },
    })

    const payment = donnees.payeCentimes > 0
      ? await tx.payment.create({
        data: {
          patientId: patient.id,
          treatmentId: treatment.id,
          montantCentimes: donnees.payeCentimes,
          datePaiement: new Date(),
          notes: donnees.notes,
          idempotencyKey: `appointment:${donnees.idempotencyKey}`,
          createdById: contexte.userId ?? '',
        },
        select: { id: true },
      })
      : null

    return { id: appointment.id, traitementId: treatment.id, paiementId: payment?.id ?? null }
  })

  await journaliser(contexte, ACTIONS.TRAITEMENT_CREE, {
    entityType: 'Traitement',
    entityId: created.traitementId,
    metadata: {
      patientId: patient.id,
      typeTraitement: donnees.typeTraitement,
      prixTotalCentimes: donnees.totalCentimes,
    },
  })

  await journaliser(contexte, ACTIONS.RENDEZ_VOUS_CREE, {
    entityType: 'RendezVous',
    entityId: created.id,
    metadata: {
      patientId: patient.id,
      traitementId: created.traitementId,
      date: donnees.date,
      totalCentimes: donnees.totalCentimes,
      payeCentimes: donnees.payeCentimes,
    },
  })

  if (created.paiementId) {
    await journaliser(contexte, ACTIONS.PAIEMENT_AJOUTE, {
      entityType: 'Paiement',
      entityId: created.paiementId,
      metadata: {
        patientId: patient.id,
        treatmentId: created.traitementId,
        montantCentimes: donnees.payeCentimes,
      },
    })
  }

  return { id: created.id, traitementId: created.traitementId, patientId: patient.id, dejaEnregistre: false }
}

// -----------------------------------------------------------------------------
//  PATIENTS SANS RENDEZ-VOUS (VISITE NON PLANIFIEE)
// -----------------------------------------------------------------------------
//
//  DECISION DE MODELISATION
//
//  Le schema ne portait AUCUN champ distinguant un rendez-vous planifie d'une
//  visite spontanee : `Appointment` ne representait que des creneaux planifies.
//  Une visite sans rendez-vous n'existait donc nulle part dans le modele, et le
//  tableau de bord n'avait aucun moyen de la connaitre.
//
//  Aucune SECONDE structure de rendez-vous n'a ete creee. Une visite spontanee
//  est enregistree DANS LA MEME TABLE `appointments`, avec des horaires reels
//  (arrivee -> depart) et un MOTIF normalise qui l'identifie :
//
//      motif = "Sans rendez-vous — <motif de consultation>"
//
//  La distinction est donc EXPLICITE et STOCKEE, jamais deduite :
//    - rendez-vous planifie  -> `motif` ne commence PAS par le marqueur ;
//    - visite spontanee      -> `motif` commence par le marqueur.
//
//  Consequences volontaires : un NOUVEAU patient reste « planifie » des lors
//  qu'il avait un creneau, et un patient EXISTANT reste « sans rendez-vous »
//  des lors qu'il s'est presente spontanement. L'anciennete du patient
//  n'intervient jamais dans la distinction.
//
//  Ce choix ne modifie NI le schema, NI les migrations, NI les contraintes
//  PostgreSQL : il n'ajoute qu'une convention de contenu, lisible et auditable.
// -----------------------------------------------------------------------------

/** Marqueur explicite d'une visite non planifiee, prefixe au motif. */
export const MARQUEUR_SANS_RENDEZ_VOUS = 'Sans rendez-vous'

/** Duree attribuee a un creneau spontane, en minutes (comptabilisation). */
const DUREE_VISITE_SPONTANEE_MINUTES = 30

/** Construit le motif stocke pour une visite spontanee. */
export function motifSansRendezVous(motifConsultation: string): string {
  return `${MARQUEUR_SANS_RENDEZ_VOUS} — ${motifConsultation}`
}

/** Vrai si le rendez-vous correspond a une VISITE SPONTANEE (sans rendez-vous). */
export function estSansRendezVous(motif: string | null): boolean {
  return (motif ?? '').startsWith(MARQUEUR_SANS_RENDEZ_VOUS)
}

/**
 * Filtre SQL : ne garder que les rendez-vous PLANIFIES (ceux qui portent ou non
 * un motif de consultation, mais jamais le marqueur de visite spontanee).
 *
 * POURQUOI CE FILTRE EST ECRIT COMME IL L'EST
 *
 * L'ecriture evidente serait :
 *
 *   NOT: { motif: { startsWith: MARQUEUR_SANS_RENDEZ_VOUS } }
 *
 * Elle est FAUSSE, et silencieusement. Prisma la traduit en
 *
 *   NOT (motif LIKE 'Sans rendez-vous%')
 *
 * or, en SQL, `NOT NULL` vaut `NULL` — ni vrai, ni faux. La ligne ne passe donc
 * pas le filtre et se fait ELIMINER. Un rendez-vous planifie dont `motif` est
 * `NULL` (le cas normal : le motif n'est saisi que pour une visite spontanee)
 * disparait donc du tableau de bord au lieu d'y figurer.
 *
 * Mesure sur la base de demonstration, pour la journee en cours :
 *
 *   rendez-vous planifies trouves par le `NOT` direct ....... 0
 *   rendez-vous planifies attendus ........................... 9
 *   rendez-vous sans rendez-vous (correctement exclus) ...... 2
 *
 * Autrement dit, TOUS les rendez-vous planifies du jour disparaisaient : la
 * premiere liste du tableau de bord restait vide et l'indicateur « Rendez-vous du
 * jour » valait 0.
 *
 * Le meme defaut affectait les trois autres requetes du tableau de bord qui
 * filtraient de cette facon (prochains rendez-vous, nouveaux rendez-vous).
 *
 * On ecrit donc l'exclusion sous la forme « le marqueur est absent », qui
 * accepte explicitement `motif IS NULL` :
 *
 *   motif: { not: { startsWith: MARQUEUR } }  ->  motif IS NULL OR motif NOT LIKE …
 *
 * Le type n'est PAS voluntarily verrouille (`as const`) : Prisma doit pouvoir
 * l'elargir pour conserver l'inclusion de `patient` dans le `select`, sans quoi
 * TypeScript ne reconnait plus le resultat renvoye.
 */
export const FILTRE_RENDEZ_VOUS_PLANIFIES = {
  OR: [{ motif: null }, { motif: { not: { startsWith: MARQUEUR_SANS_RENDEZ_VOUS } } }],
}

/**
 * Extrait le motif de consultation lisible d'une visite spontanee.
 * Le marqueur technique est retire : l'interface affiche « Extraction dentaire »
 * et non « Sans rendez-vous — Extraction dentaire ».
 */
export function motifConsultationDe(motif: string | null): string | null {
  if (!estSansRendezVous(motif)) return motif
  const consultation = (motif ?? '').slice(MARQUEUR_SANS_RENDEZ_VOUS.length).replace(/^\s*—\s*/, '')
  return consultation.length > 0 ? consultation : null
}

/**
 * ENREGISTRE UNE VISITE SANS RENDEZ-VOUS.
 *
 * Le patient s'est presente aujourd'hui sans creneau planifie : la visite est
 * consignee avec l'heure REELLE d'arrivee et le motif de consultation.
 *
 * Aucun conflit n'est recherche : c'est precisement l'absence de creneau
 * reserve qui caracterise cette visite. Bloquer l'enregistrement parce qu'un
 * autre patient occupe le creneau rendrait la fonction inutilisable en cabinet.
 */
export async function enregistrerVisiteSansRendezVous(
  donnees: {
    patientId: string
    motifConsultation: string
    /** Debut de la consultation. Par defaut : l'instant present. */
    dateDebut?: Date
  },
  contexte: JournalContext,
): Promise<{ id: string }> {
  const patient = await prisma.patient.findUnique({
    where: { id: donnees.patientId },
    select: { id: true },
  })
  if (!patient) throw erreurs.introuvable('Patient')

  const motifConsultation = donnees.motifConsultation.trim()
  if (motifConsultation.length === 0) {
    throw erreurs.validation('Indiquez le motif de la consultation.', [
      { champ: 'motifConsultation', message: 'Le motif de consultation est obligatoire.' },
    ])
  }

  const dateDebut = donnees.dateDebut ?? new Date()
  const dateFin = new Date(dateDebut.getTime() + DUREE_VISITE_SPONTANEE_MINUTES * 60_000)

  const visite = await prisma.appointment.create({
    data: {
      patientId: donnees.patientId,
      dateDebut,
      dateFin,
      dents: JSON.stringify([]),
      motif: motifSansRendezVous(motifConsultation),
      notes: null,
      statut: 'TERMINE',
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.RENDEZ_VOUS_CREE, {
    entityType: 'RendezVous',
    entityId: visite.id,
    metadata: {
      patientId: donnees.patientId,
      sansRendezVous: true,
      motifConsultation,
      dateDebut: dateDebut.toISOString(),
    },
  })

  return visite
}

/**
 * Modifie un rendez-vous (hors reprogrammation de creneau).
 *
 * Si les horaires changent, un CONFLIT est verifie et un enregistrement
 * d'HISTORIQUE est cree : la modification d'horaire passe par le meme mecanisme
 * que la reprogrammation, pour ne jamais perdre l'ancien creneau (§15).
 */
/**
 * Champs modifiables d'un rendez-vous.
 * `patientId` en est volontairement exclu : on ne deplace pas un rendez-vous
 * d'un patient a un autre, on en cree un nouveau.
 */
export interface DonneesModificationRendezVous {
  dateDebut?: Date
  dateFin?: Date
  treatmentId?: string | null
  dents?: string[]
  motif?: string | null
  notes?: string | null
  statut?: StatutRendezVous
  motifStatut?: string | null
}

export async function modifierRendezVous(
  id: string,
  donnees: DonneesModificationRendezVous,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.appointment.findUnique({ where: { id } })
  if (!existant) throw erreurs.introuvable('Rendez-vous')

  const nouvelleDateDebut = donnees.dateDebut ?? existant.dateDebut
  const nouvelleDateFin = donnees.dateFin ?? existant.dateFin
  const horaireChange =
    nouvelleDateDebut.getTime() !== existant.dateDebut.getTime() ||
    nouvelleDateFin.getTime() !== existant.dateFin.getTime()

  if (horaireChange) {
    const conflict = await detecterConflit({
      dateDebut: nouvelleDateDebut,
      dateFin: nouvelleDateFin,
      exclureId: id,
    })
    if (conflict.enConflit && conflict.rendezVous) {
      throw erreurs.rendezVousEnConflit(messageConflit(conflict.rendezVous))
    }
  }

  await prisma.$transaction(async (tx) => {
    // Historique AVANT la mise a jour : l'ancien creneau est fige.
    if (horaireChange) {
      await tx.appointmentReschedule.create({
        data: {
          appointmentId: id,
          ancienneDateDebut: existant.dateDebut,
          ancienneDateFin: existant.dateFin,
          nouvelleDateDebut,
          nouvelleDateFin,
          motif: null,
          modifieParId: contexte.userId,
        },
      })
    }

    await tx.appointment.update({
      where: { id },
      data: {
        ...(donnees.dateDebut ? { dateDebut: donnees.dateDebut } : {}),
        ...(donnees.dateFin ? { dateFin: donnees.dateFin } : {}),
        ...(donnees.treatmentId !== undefined ? { treatmentId: donnees.treatmentId } : {}),
        ...(donnees.dents ? { dents: JSON.stringify(donnees.dents) } : {}),
        ...(donnees.motif !== undefined ? { motif: donnees.motif } : {}),
        ...(donnees.notes !== undefined ? { notes: donnees.notes } : {}),
        ...(donnees.statut ? { statut: donnees.statut } : {}),
        ...(donnees.motifStatut !== undefined ? { motifStatut: donnees.motifStatut } : {}),
      },
    })
  })

  await journaliser(contexte, ACTIONS.RENDEZ_VOUS_MODIFIE, {
    entityType: 'RendezVous',
    entityId: id,
    metadata: { horaireChange },
  })
}

/**
 * REPROGRAMMATION (§15).
 *
 * Exemple de la specification :
 *   Origine 1er aout 10:00  ->  Reprogramme le 5 aout 14:00
 *
 * Le systeme conserve l'ancienne date, l'ancienne heure, la nouvelle date, la
 * nouvelle heure, l'utilisateur, l'horodatage et le motif eventuel. RIEN n'est
 * ecrase. Avant enregistrement, un conflit est verifie.
 */
export async function reprogrammerRendezVous(
  id: string,
  donnees: { dateDebut: Date; dateFin: Date; motif: string | null },
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.appointment.findUnique({ where: { id } })
  if (!existant) throw erreurs.introuvable('Rendez-vous')

  const conflict = await detecterConflit({
    dateDebut: donnees.dateDebut,
    dateFin: donnees.dateFin,
    exclureId: id,
  })
  if (conflict.enConflit && conflict.rendezVous) {
    throw erreurs.rendezVousEnConflit(messageConflit(conflict.rendezVous))
  }

  await prisma.$transaction(async (tx) => {
    // 1. Historique : l'ancien creneau est conserve integralement.
    await tx.appointmentReschedule.create({
      data: {
        appointmentId: id,
        ancienneDateDebut: existant.dateDebut,
        ancienneDateFin: existant.dateFin,
        nouvelleDateDebut: donnees.dateDebut,
        nouvelleDateFin: donnees.dateFin,
        motif: donnees.motif,
        modifieParId: contexte.userId,
      },
    })

    // 2. Le rendez-vous porte le nouveau creneau et le statut « Reprogramme ».
    await tx.appointment.update({
      where: { id },
      data: {
        dateDebut: donnees.dateDebut,
        dateFin: donnees.dateFin,
        statut: 'REPROGRAMME',
        motifStatut: donnees.motif,
      },
    })
  })

  await journaliser(contexte, ACTIONS.RENDEZ_VOUS_REPROGRAMME, {
    entityType: 'RendezVous',
    entityId: id,
    metadata: {
      ancienneDate: existant.dateDebut.toISOString(),
      nouvelleDate: donnees.dateDebut.toISOString(),
    },
  })
}

/** Historique complet des reprogrammations d'un rendez-vous. */
export async function historiqueReprogrammations(id: string): Promise<
  Array<{
    id: string
    ancienneDateDebut: Date
    ancienneDateFin: Date
    nouvelleDateDebut: Date
    nouvelleDateFin: Date
    motif: string | null
    modifiePar: string | null
    createdAt: Date
  }>
> {
  const lignes = await prisma.appointmentReschedule.findMany({
    where: { appointmentId: id },
    orderBy: { createdAt: 'desc' },
    include: { modifiePar: { select: { displayName: true, email: true } } },
  })

  return lignes.map((ligne) => ({
    id: ligne.id,
    ancienneDateDebut: ligne.ancienneDateDebut,
    ancienneDateFin: ligne.ancienneDateFin,
    nouvelleDateDebut: ligne.nouvelleDateDebut,
    nouvelleDateFin: ligne.nouvelleDateFin,
    motif: ligne.motif,
    modifiePar: ligne.modifiePar?.displayName ?? ligne.modifiePar?.email ?? null,
    createdAt: ligne.createdAt,
  }))
}

/** Change le statut d'un rendez-vous (confirme, termine, absent...). */
export async function changerStatut(
  id: string,
  statut: StatutRendezVous,
  motifStatut: string | null,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.appointment.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Rendez-vous')

  await prisma.appointment.update({
    where: { id },
    data: { statut, motifStatut },
  })

  await journaliser(contexte, ACTIONS.RENDEZ_VOUS_MODIFIE, {
    entityType: 'RendezVous',
    entityId: id,
    metadata: { statut, motifStatut },
  })
}

/**
 * Rendez-vous d'un patient, pour sa fiche.
 *
 * PAGINATION SERVEUR (§35) : au fil des annees, un patient accumule de nombreux
 * rendez-vous. Une page complete est renvoyee (elements + total + pages).
 */
export async function rendezVousDuPatient(
  patientId: string,
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<PatientRendezVousDetaille>> {
  const page = await listerRendezVous({ patientId, ...pagination })

  // Identifiants des traitements lies aux rendez-vous de CETTE page uniquement :
  // l'agregation reste bornee au volume affiche, jamais a l'historique complet.
  const idsTraitements = [
    ...new Set(
      page.elements
        .map((rdv) => rdv.treatmentId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]

  if (idsTraitements.length === 0) {
    return { ...page, elements: page.elements.map((rdv) => ({ ...rdv, traitement: null })) }
  }

  const [traitements, montantsPayes] = await Promise.all([
    prisma.treatment.findMany({
      where: { id: { in: idsTraitements } },
      select: { id: true, typeTraitement: true, prixTotalCentimes: true, statut: true },
    }),
    // MEME helper que la liste des traitements : une seule requete d'agregation,
    // et la meme regle de calcul (paiements VALIDE uniquement).
    calcTotalPaye(idsTraitements),
  ])

  const parId = new Map(traitements.map((traitement) => [traitement.id, traitement]))

  const elements: PatientRendezVousDetaille[] = page.elements.map((rdv) => {
    const traitement = rdv.treatmentId ? parId.get(rdv.treatmentId) : undefined
    if (!traitement) return { ...rdv, traitement: null }

    const montantPayeCentimes = montantsPayes.get(traitement.id) ?? 0
    return {
      ...rdv,
      traitement: {
        id: traitement.id,
        typeTraitement: traitement.typeTraitement,
        prixTotalCentimes: traitement.prixTotalCentimes,
        montantPayeCentimes,
        resteAPayerCentimes: traitement.prixTotalCentimes - montantPayeCentimes,
        statut: traitement.statut,
      },
    }
  })

  return { ...page, elements }
}

/** Nombre de rendez-vous sur une periode (tableau de bord, rapports). */
export async function compterRendezVous(debut: Date, fin: Date): Promise<number> {
  return prisma.appointment.count({
    where: {
      dateDebut: { gte: debut, lte: fin },
      statut: { notIn: ['ANNULE'] },
    },
  })
}
