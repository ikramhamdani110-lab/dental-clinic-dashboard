import { z } from 'zod'

/**
 * =============================================================================
 *  SCHEMAS DE VALIDATION — FINANCES PRIVÉES (§finances)
 * =============================================================================
 *  Complète `backend/validation/schemas.ts` (qui porte les schemas cliniques)
 *  avec les schemas propres à l'espace financier privé du médecin.
 *
 *  RÈGLE DES MONTANTS (§12) : centimes ENTIERS, jamais de flottant. Les
 *  schemas exposent `montantCentimes` (number entier) — la conversion depuis
 *  la saisie en dinars est faite côté client, comme pour les paiements.
 */

/**
 * Date de l'espace financier : ISO locale (YYYY-MM-DD) OU datetime ISO avec
 * fuseau — convertie en Date. Le format court est interprété à midi local
 * (convention du cabinet : une dépense « 2026-11-02 » vaut pour la journée).
 */
const dateFinanciere = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.string().datetime({ offset: true }),
  ])
  .transform((valeur) => new Date(valeur.length === 10 ? `${valeur}T12:00:00` : valeur))

// -----------------------------------------------------------------------------
//  REVENUS MANUELS — argent reçu HORS circuit clinique (§finances-manuel)
// -----------------------------------------------------------------------------

/** Création. */
export const revenuManuelCreationSchema = z.object({
  montantCentimes: z.number().int().positive(),
  date: dateFinanciere,
  categorie: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Clé d'idempotence fournie par le client (anti-doublon §17). */
  idempotencyKey: z.string().trim().min(8).max(120),
})

/** Modification (sans idempotencyKey — jamais modifiable). */
export const revenuManuelModificationSchema = z.object({
  montantCentimes: z.number().int().positive().optional(),
  date: dateFinanciere.optional(),
  categorie: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
})

// -----------------------------------------------------------------------------
//  DÉPENSES DU CABINET (matériel, fournitures, loyer…)
// -----------------------------------------------------------------------------

/** Création. */
export const depenseCreationSchema = z.object({
  montantCentimes: z.number().int().positive(),
  date: dateFinanciere,
  categorie: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
})

/** Modification (sans idempotencyKey). */
export const depenseModificationSchema = z.object({
  montantCentimes: z.number().int().positive().optional(),
  date: dateFinanciere.optional(),
  categorie: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
})

// -----------------------------------------------------------------------------
//  TRANSACTIONS PERSONNELLES DU MÉDECIN — strictement séparées du cabinet
// -----------------------------------------------------------------------------

/** Création. */
export const transactionPersonnelleCreationSchema = z.object({
  nature: z.enum(['REVENUE', 'DEPENSE', 'DETTE_PERSONNELLE']),
  /** Interprété uniquement si nature = DETTE_PERSONNELLE (DO / DU_PAR_UN_TIERS). */
  direction: z.enum(['DO', 'DU_PAR_UN_TIERS']).optional(),
  montantCentimes: z.number().int().positive(),
  date: dateFinanciere,
  titre: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
})

/** Modification (sans idempotencyKey). */
export const transactionPersonnelleModificationSchema = z.object({
  montantCentimes: z.number().int().positive().optional(),
  nature: z.enum(['REVENUE', 'DEPENSE', 'DETTE_PERSONNELLE']).optional(),
  direction: z.enum(['DO', 'DU_PAR_UN_TIERS']).nullable().optional(),
  date: dateFinanciere.optional(),
  titre: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(1000).optional(),
})
