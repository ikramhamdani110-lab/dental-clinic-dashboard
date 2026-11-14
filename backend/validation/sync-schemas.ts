import { z } from 'zod'

/**
 * =============================================================================
 *  SCHEMAS DE VALIDATION — SYNCHRONISATION OFFLINE-FIRST
 * =============================================================================
 *  Tout payload recu du bureau est valide cote serveur AVANT tout acces base.
 *  Un payload invalide produit une 422 francaise, jamais une erreur technique.
 */

/** UUID strict. */
const uuidSchema = z.string().uuid()

/** Une operation individuelle poussée par le bureau. */
const operationSchema = z.object({
  operationId: uuidSchema,
  entityType: z.enum([
    'patients',
    'appointments',
    'treatments',
    'payments',
    'documents',
    'prescriptions',
    'odontogramEntries',
    'medicalRecords',
  ]),
  entityId: uuidSchema,
  operation: z.enum(['CREATE', 'UPDATE', 'TRASH', 'RESTORE']),
  /** Payload libre, valide par table dans le service de synchronisation. */
  payload: z.record(z.string(), z.unknown()),
})

/** Lot de synchronisation (push). Borne a 500 operations par requete. */
export const idempotentLotSchema = z
  .object({
    deviceId: uuidSchema,
    /** Jeton d'appareil opaque. Jamais journalise, jamais retourne au client. */
    jetonAppareil: z.string().min(20).max(200),
    operations: z.array(operationSchema).min(1).max(500),
  })
  .strict()

/** Requete de tirage (pull) : tables souhaitees + jeton d'appareil. */
export const pullSchema = z
  .object({
    deviceId: uuidSchema,
    jetonAppareil: z.string().min(20).max(200),
    tables: z
      .array(
        z.enum([
          'patients',
          'appointments',
          'treatments',
          'payments',
          'documents',
          'prescriptions',
          'odontogramEntries',
          'medicalRecords',
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict()

/** Appairage d'un nouvel appareil depuis /parametres. */
export const appairageSchema = z
  .object({
    deviceId: uuidSchema,
    label: z.string().trim().max(80).optional(),
  })
  .strict()

/** Revocation d'un appareil. */
export const revocationSchema = z
  .object({
    deviceId: uuidSchema,
    raison: z.string().trim().min(3).max(200),
  })
  .strict()
