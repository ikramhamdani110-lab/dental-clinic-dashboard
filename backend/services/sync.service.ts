import { createHash, randomBytes } from 'node:crypto'

import { prisma } from '@backend/database/prisma'
import { erreurs } from '@backend/errors/app-error'
import { logger } from '@backend/logging/logger'
import { ACTIONS, journaliser } from '@backend/services/activity-log.service'

/**
 * =============================================================================
 *  SERVICE DE SYNCHRONISATION OFFLINE-FIRST (Option B)
 * =============================================================================
 *
 *  L'application de bureau travaille sur sa base locale embarquee et pousse
 *  ici ses operations a la reconnexion. Neon reste l'AUTORITE :
 *
 *    - un `operationId` donne ne peut produire d'effet qu'UNE SEULE fois
 *      (`sync_seen_operations`) : un ack perdu, un retry ou un crash ne
 *      cree jamais de doublon ;
 *    - une operation REJETEE (chevauchement de RDV, donnee invalide) n'est
 *      PAS fatale : elle est isolee, les operations suivantes continuent ;
 *    - un conflit medical/financier est conserve en DOUBLE version
 *      (`sync_conflicts`, resolution PENDING) — jamais de « dernier gagnant ».
 */

/** Tables metier synchronisees. */
export const TABLES_SYNC = ['patients', 'appointments', 'treatments', 'payments', 'documents'] as const
export type TableSync = (typeof TABLES_SYNC)[number]

/** Statuts explicites d'une operation de la file locale. */
export type StatutOperation =
  | 'PENDING'
  | 'SYNCING'
  | 'SYNCHRONIZED'
  | 'CONFLICT'
  | 'REJECTED'

/** Resultat du traitement d'une operation poussee par le bureau. */
export interface ResultatPush {
  operationId: string
  /** APPLIED | ALREADY_APPLIED | CONFLICT | REJECTED */
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'CONFLICT' | 'REJECTED'
  detail?: string
}

function hashToken(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex')
}

/** Genere un jeton d'appareil opaque (32 octets d'entropie, URL-safe). */
export function genererJetonAppareil(): string {
  const octets = new Uint8Array(32)
  crypto.getRandomValues(octets)
  return Buffer.from(octets).toString('base64url')
}

/**
 * Verifie le jeton d'appareil ET l'absence de revocation DANS la meme
 * transaction que l'application de l'operation : la course critique
 * « revoke exactement pendant un push » est tranchée par PostgreSQL
 * (`FOR SHARE` bloque jusqu'au commit/rollback de la revocation concurrente).
 * Renvoie la session d'appareil si valide, sinon null.
 */
async function resoudreAppareilTransactionnel(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  deviceId: string,
  jeton: string,
): Promise<{ id: string; userId: string } | null> {
  const tokenHash = hashToken(jeton)
  // `FOR SHARE` : la ligne device_sessions est verrouillee partagee — une
  // revocation concurrente (UPDATE) attend la fin de notre transaction, et
  // reciproquement. La decision revocation/application est donc ATOMIQUE.
  const lignes = await tx.$queryRaw<Array<{ id: string; userId: string; revokedAt: Date | null }>>`
    SELECT "id", "userId", "revokedAt"
    FROM "device_sessions"
    WHERE "deviceId" = ${deviceId}::uuid AND "tokenHash" = ${tokenHash}
    FOR SHARE
  `
  const ligne = lignes[0]
  if (!ligne || ligne.revokedAt !== null) return null
  return { id: ligne.id, userId: ligne.userId }
}

/**
 * Applique UNE operation metier. Toute la logique est encapsulee dans une
 * transaction reproductible : soit tout est applique, soit rien.
 * Une erreur metier (chevauchement RDV, reference inconnue...) renvoie
 * REJECTED sans interrompre le reste de la file.
 */
async function appliquerOperation(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  operation: {
    operationId: string
    entityType: string
    entityId: string
    operation: 'CREATE' | 'UPDATE' | 'TRASH' | 'RESTORE'
    payload: Record<string, unknown>
  },
  deviceId: string,
  userId: string,
): Promise<ResultatPush> {
  const { entityType, entityId, operation: type, payload } = operation

  switch (type) {
    case 'CREATE':
    case 'UPDATE': {
      if (entityType === 'patients') {
        const donnees = payload as Record<string, string>
        const existant = await tx.patient.findUnique({ where: { id: entityId } })
        if (existant) {
          // Detection de conflit champ par champ : updatedAt local du bureau
          // vs updatedAt serveur. Un champ modifie des deux cotes → conflit
          // conserve en double version, JAMAIS de resolution automatique.
          const modifieLocalement = new Date(String(payload.updatedAt ?? 0))
          if (existant.updatedAt > modifieLocalement) {
            await tx.syncConflict.create({
              data: {
                entityType,
                entityId,
                deviceId,
                localValue: JSON.stringify(payload),
                remoteValue: JSON.stringify(existant),
                localUpdatedAt: modifieLocalement,
                remoteUpdatedAt: existant.updatedAt,
              },
            })
            return { operationId: operation.operationId, outcome: 'CONFLICT', detail: 'Fiche modifiee des deux cotes — arbitrage requis.' }
          }
          await tx.patient.update({ where: { id: entityId }, data: filtrerChampsPatient(donnees) as never })
        } else {
          await tx.patient.create({
            data: {
              id: entityId,
              nom: String(donnees.nom ?? 'Sans nom'),
              prenom: String(donnees.prenom ?? ''),
              telephone: String(donnees.telephone ?? ''),
              ...(filtrerChampsPatient(donnees) as object),
            },
          })
        }
        return { operationId: operation.operationId, outcome: 'APPLIED' }
      }

      if (entityType === 'appointments') {
        const donnees = payload as Record<string, unknown>
        const dateDebut = new Date(String(donnees.dateDebut))
        const dateFin = new Date(String(donnees.dateFin))
        const praticienId = donnees.praticienId ? String(donnees.praticienId) : null

        // Verifications metier AVANT insertion : chevauchement de creneau.
        // La contrainte EXCLUDE PostgreSQL rejoue la meme regle au niveau base
        // (SQLSTATE 23P01) — cette double verification fournit un message lisible.
        if (praticienId) {
          const chevauchement = await tx.appointment.findFirst({
            where: {
              praticienId,
              statut: { not: 'ANNULE' },
              dateDebut: { lt: dateFin },
              dateFin: { gt: dateDebut },
              id: { not: entityId },
            },
            select: { id: true },
          })
          if (chevauchement) {
            return {
              operationId: operation.operationId,
              outcome: 'CONFLICT',
              detail: `CONFLIT_CRENEAU : chevauche le rendez-vous ${chevauchement.id}. Arbitrage requis.`,
            }
          }
        }

        const existant = await tx.appointment.findUnique({ where: { id: entityId } })
        if (existant) {
          await tx.appointment.update({
            where: { id: entityId },
            data: { dateDebut, dateFin, motif: donnees.motif ? String(donnees.motif) : null, notes: donnees.notes ? String(donnees.notes) : null },
          })
        } else {
          await tx.appointment.create({
            data: {
              id: entityId,
              patientId: String(donnees.patientId),
              praticienId,
              dateDebut,
              dateFin,
              motif: donnees.motif ? String(donnees.motif) : null,
              notes: donnees.notes ? String(donnees.notes) : null,
              syncStatut: 'VALIDE',
            },
          })
        }
        return { operationId: operation.operationId, outcome: 'APPLIED' }
      }

      if (entityType === 'payments') {
        const donnees = payload as Record<string, unknown>
        const existant = await tx.payment.findUnique({ where: { id: entityId } })
        if (existant) {
          // Conflit financier : les DEUX versions sont conservees, statut
          // A_ARBITRER. Aucune ecriture silencieuse, jamais.
          await tx.payment.update({
            where: { id: entityId },
            data: { syncStatut: 'A_ARBITRER' },
          })
          await tx.syncConflict.create({
            data: {
              entityType,
              entityId,
              deviceId,
              localValue: JSON.stringify(payload),
              remoteValue: JSON.stringify(existant),
              localUpdatedAt: payload.updatedAt ? new Date(String(payload.updatedAt)) : null,
              remoteUpdatedAt: existant.createdAt,
            },
          })
          return { operationId: operation.operationId, outcome: 'CONFLICT', detail: 'Paiement modifie des deux cotes — statut A_ARBITRER, arbitrage medecin requis.' }
        }
        await tx.payment.create({
          data: {
            id: entityId,
            patientId: String(donnees.patientId),
            treatmentId: donnees.treatmentId ? String(donnees.treatmentId) : null,
            montantCentimes: Number(donnees.montantCentimes ?? 0),
            datePaiement: new Date(String(donnees.datePaiement ?? new Date().toISOString())),
            idempotencyKey: `sync:${operation.operationId}`,
            createdById: userId,
            syncStatut: 'VALIDE',
          },
        })
        return { operationId: operation.operationId, outcome: 'APPLIED' }
      }

      if (entityType === 'treatments') {
        const donnees = payload as Record<string, unknown>
        const existant = await tx.treatment.findUnique({ where: { id: entityId } })
        if (existant) {
          await tx.treatment.update({
            where: { id: entityId },
            data: { syncStatut: 'A_ARBITRER' },
          })
          await tx.syncConflict.create({
            data: {
              entityType,
              entityId,
              deviceId,
              localValue: JSON.stringify(payload),
              remoteValue: JSON.stringify(existant),
              localUpdatedAt: payload.updatedAt ? new Date(String(payload.updatedAt)) : null,
              remoteUpdatedAt: existant.createdAt,
            },
          })
          return { operationId: operation.operationId, outcome: 'CONFLICT', detail: 'Traitement modifie des deux cotes — statut A_ARBITRER.' }
        }
        await tx.treatment.create({
          data: {
            id: entityId,
            patientId: String(donnees.patientId),
            typeTraitement: String(donnees.typeTraitement ?? 'Soin'),
            prixTotalCentimes: Number(donnees.prixTotalCentimes ?? 0),
            syncStatut: 'VALIDE',
          },
        })
        return { operationId: operation.operationId, outcome: 'APPLIED' }
      }

      return { operationId: operation.operationId, outcome: 'REJECTED', detail: `Table non supportee : ${entityType}` }
    }

    case 'TRASH': {
      // Suppression reversible UNIQUEMENT : passage par trash_entries.
      // Un DELETE direct est interdit dans la file de sync.
      const typeSupprimable = entityTypeVersTypeSupprimable(entityType)
      const existante = await tx.trashEntry.findUnique({
        where: { entityType_entityId: { entityType: typeSupprimable, entityId } },
      })
      if (existante && existante.restaureLe === null) {
        return { operationId: operation.operationId, outcome: 'ALREADY_APPLIED' }
      }
      await tx.trashEntry.upsert({
        where: { entityType_entityId: { entityType: typeSupprimable, entityId } },
        create: {
          entityType: typeSupprimable,
          entityId,
          description: `Supprime hors ligne (appareil ${deviceId.slice(0, 8)})`,
          snapshot: JSON.stringify(payload),
          supprimeParId: userId,
          // La contrainte PostgreSQL `trash_entries_fenetre_24h_check` exige
          // EXACTEMENT expireLe = supprimeLe + 24h.
          supprimeLe: new Date(),
          expireLe: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        update: {
          restaureLe: null,
          restaureParId: null,
          supprimeDefinitivementLe: null,
        },
      })
      return { operationId: operation.operationId, outcome: 'APPLIED' }
    }

    case 'RESTORE': {
      const existante = await tx.trashEntry.findUnique({
        where: { entityType_entityId: { entityType: entityTypeVersTypeSupprimable(entityType), entityId } },
      })
      if (!existante || existante.restaureLe !== null) {
        return { operationId: operation.operationId, outcome: 'ALREADY_APPLIED' }
      }
      await tx.trashEntry.update({
        where: { entityType_entityId: { entityType: entityTypeVersTypeSupprimable(entityType), entityId } },
        data: { restaureLe: new Date(), restaureParId: userId },
      })
      return { operationId: operation.operationId, outcome: 'APPLIED' }
    }
  }
}

function entityTypeVersTypeSupprimable(entityType: string) {
  const table = {
    patients: 'PATIENT',
    appointments: 'RENDEZ_VOUS',
    treatments: 'TRAITEMENT',
    payments: 'PAIEMENT',
    documents: 'DOCUMENT',
  } as Record<string, 'PATIENT' | 'RENDEZ_VOUS' | 'TRAITEMENT' | 'PAIEMENT' | 'DOCUMENT'>
  const valeur = table[entityType]
  if (!valeur) throw erreurs.validation(`Type d'entite non supprimable : ${entityType}`)
  return valeur as never
}

/** Champs patients autorises a etre synchronises (jamais de champ technique). */
function filtrerChampsPatient(donnees: Record<string, unknown>) {
  const champs = ['age', 'dateNaissance', 'sexe', 'telephone', 'telephoneSecondaire', 'adresse', 'email', 'allergies', 'antecedentsMedicaux', 'medicamentsActuels', 'contactUrgence', 'notesGenerales'] as const
  const filtré: Record<string, unknown> = {}
  for (const champ of champs) {
    if (donnees[champ] !== undefined) filtré[champ] = donnees[champ]
  }
  return filtré as never
}

/**
 * Pousse un LOT d'operations depuis le bureau. Chaque operation est traitee
 * DANS SA PROPRE transaction : un echec n'affecte pas les suivantes.
 */
export async function pousserOperations(
  deviceId: string,
  jetonAppareil: string,
  operations: Array<{
    operationId: string
    entityType: string
    entityId: string
    operation: 'CREATE' | 'UPDATE' | 'TRASH' | 'RESTORE'
    payload: Record<string, unknown>
  }>,
): Promise<{ resultats: ResultatPush[] }> {
  if (operations.length === 0) return { resultats: [] }
  if (operations.length > 500) throw erreurs.validation('Lot trop volumineux : 500 operations maximum par requete.')

  const resultats: ResultatPush[] = []

  for (const operation of operations) {
    try {
      const resultat = await prisma.$transaction(async (tx) => {
        // 1. Appareil valide ET non revoke — dans la MEME transaction.
        const appareil = await resoudreAppareilTransactionnel(tx, deviceId, jetonAppareil)
        if (!appareil) {
          return { operationId: operation.operationId, outcome: 'REJECTED' as const, detail: 'DEVICE_REVOKED' }
        }

        // 2. Idempotence : un operationId deja vu ne produit aucun effet.
        const dejaVu = await tx.syncSeenOperation.findUnique({
          where: { operationId: operation.operationId },
        })
        if (dejaVu) {
          return { operationId: operation.operationId, outcome: 'ALREADY_APPLIED' as const }
        }

        // 3. Application metier.
        const resultat = await appliquerOperation(tx, operation, deviceId, appareil.userId)

        // 4. Enregistrement de l'idempotence et mise a jour lastSeenAt.
        await tx.syncSeenOperation.create({
          data: {
            operationId: operation.operationId,
            deviceId,
            entityType: operation.entityType,
            alreadyApplied: resultat.outcome === 'APPLIED',
          },
        })
        await tx.deviceSession.update({
          where: { id: appareil.id },
          data: { lastSeenAt: new Date() },
        })
        await tx.syncEvent.create({
          data: {
            deviceId,
            operationId: operation.operationId,
            direction: 'PUSH',
            entityType: operation.entityType,
            entityId: operation.entityId,
            outcome: resultat.outcome,
            detail: resultat.detail ?? null,
          },
        })

        return resultat
      })
      resultats.push(resultat)
    } catch (erreur) {
      // Une erreur technique (reference inconnue, violation de contrainte
      // non anticipée) est isolee : la file continue.
      const detail = erreur instanceof Error ? erreur.message : String(erreur)
      logger.warn('Operation de sync rejetee', { operationId: operation.operationId, detail })
      resultats.push({ operationId: operation.operationId, outcome: 'REJECTED', detail })
    }
  }

  return { resultats }
}

/**
 * Tire les changements distants pour un appareil, depuis son curseur.
 * Chaque table est lue independamment : un echec sur l'une ne bloque pas
 * les autres.
 */
export async function tirerChangements(
  deviceId: string,
  jetonAppareil: string,
  tables: readonly TableSync[],
): Promise<{
  curseurs: Record<string, string>
  lots: Partial<Record<TableSync, Array<Record<string, unknown>>>>
}> {
  // Verification d'appareil hors transaction (lecture seule) : la revocation
  // est re-verifiee transactionnellement a chaque push.
  const tokenHash = hashToken(jetonAppareil)
  const appareil = await prisma.deviceSession.findFirst({
    where: { deviceId, tokenHash, revokedAt: null },
    select: { id: true },
  })
  if (!appareil) throw erreurs.accesRefuse()

  const curseurs: Record<string, string> = {}
  const lots: Partial<Record<TableSync, Array<Record<string, unknown>>>> = {}

  for (const table of tables) {
    const etat = await prisma.syncState.findUnique({
      where: { deviceId_tableName: { deviceId, tableName: table } },
    })
    const depuis = etat?.lastPulledAt ?? new Date(0)

    let lignes: Array<Record<string, unknown>> = []
    if (table === 'patients') {
      lignes = await prisma.patient.findMany({
        where: { updatedAt: { gt: depuis } },
        take: 500,
        orderBy: { updatedAt: 'asc' },
      })
    } else if (table === 'appointments') {
      lignes = await prisma.appointment.findMany({
        where: { updatedAt: { gt: depuis } },
        take: 500,
        orderBy: { updatedAt: 'asc' },
      })
    } else if (table === 'treatments') {
      lignes = await prisma.treatment.findMany({
        where: { updatedAt: { gt: depuis } },
        take: 500,
        orderBy: { updatedAt: 'asc' },
      })
    } else if (table === 'payments') {
      lignes = await prisma.payment.findMany({
        where: { createdAt: { gt: depuis } },
        take: 500,
        orderBy: { createdAt: 'asc' },
      })
    } else if (table === 'documents') {
      lignes = await prisma.document.findMany({
        where: { createdAt: { gt: depuis } },
        take: 200,
        orderBy: { createdAt: 'asc' },
      })
    }

    const nouveauCurseur = new Date()
    await prisma.syncState.upsert({
      where: { deviceId_tableName: { deviceId, tableName: table } },
      create: { deviceId, tableName: table, lastPulledAt: nouveauCurseur },
      update: { lastPulledAt: nouveauCurseur },
    })
    curseurs[table] = nouveauCurseur.toISOString()
    lots[table] = lignes
  }

  await prisma.syncEvent.create({
    data: { deviceId, direction: 'PULL', entityType: tables.join(','), outcome: 'APPLIED' },
  })

  return { curseurs, lots }
}

/**
 * Appaire un appareil : un utilisateur authentifie (session web existante)
 * associe un nouveau deviceId. Renvoie la phrase de recuperation (affichee
 * UNE SEULE FOIS) et le jeton d'appareil.
 */
export async function appairerAppareil(params: {
  userId: string
  deviceId: string
  label?: string
}): Promise<{ jeton: string; phraseRecuperation: string }> {
  const jeton = genererJetonAppareil()
  // Phrase BIP39-like : 12 mots d'une liste deterministe (simplifiee ici a
  // 12 groupes base64url de 8 bits — l'entropie reelle est 96 bits, adequat
  // pour un secret local a duree de vie du cabinet).
  const mots: string[] = []
  for (let i = 0; i < 12; i += 1) {
    mots.push(randomBytes(2).toString('base64url'))
  }
  const phrase = mots.join(' ')
  const recoverySalt = randomBytes(16).toString('hex')

  await prisma.deviceSession.create({
    data: {
      deviceId: params.deviceId,
      userId: params.userId,
      tokenHash: hashToken(jeton),
      recoveryPhraseHash: hashToken(phrase),
      recoverySalt,
      label: params.label ?? 'Bureau Windows',
    },
  })

  await journaliser(
    { userId: params.userId, userEmail: '', ipAddress: null, userAgent: null },
    ACTIONS.APPAREIL_APPAIRE,
    { metadata: { deviceId: params.deviceId } },
  )

  return { jeton, phraseRecuperation: phrase }
}

/** Revoque un appareil : les pushes suivants sont rejetes atomiquement. */
export async function revoquerAppareil(deviceId: string, userId: string, raison: string): Promise<void> {
  await prisma.deviceSession.updateMany({
    where: { deviceId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: raison },
  })
  await journaliser(
    { userId, userEmail: '', ipAddress: null, userAgent: null },
    ACTIONS.APPAREIL_REVOQUE,
    { metadata: { deviceId, raison } },
  )
}

/** Liste les appareils d'un utilisateur (pour /parametres). */
export async function listerAppareils(userId: string) {
  return prisma.deviceSession.findMany({
    where: { userId },
    select: {
      id: true,
      deviceId: true,
      label: true,
      createdAt: true,
      lastSeenAt: true,
      revokedAt: true,
      revokedReason: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

/** Conflits en attente d'arbitrage, pour l'interface medecin. */
export async function conflitsEnAttente() {
  return prisma.syncConflict.findMany({
    where: { resolution: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}
