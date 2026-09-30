import { PrismaClient } from '@prisma/client'

/**
 * =============================================================================
 *  ACCES A LA BASE POSTGRESQL REELLE POUR LES TESTS D'INTEGRATION
 * =============================================================================
 *
 *  Principe de NON-SIMULATION (docs/TESTS.md) : un test qui ne s'execute pas
 *  n'est pas un test, et un test qui s'execute contre un double n'est pas une
 *  preuve d'integration. Les tests de ce module s'executent contre une vraie
 *  instance PostgreSQL 16, avec le schema reel produit par les migrations.
 *
 *  La base cible est designee par `TEST_DATABASE_URL`. Elle ne doit JAMAIS etre
 *  la base d'exploitation du cabinet : ces tests ECRIVENT et SUPPRIMENT des
 *  lignes. Si la variable est absente, les tests d'integration sont SIGNALES
 *  COMME IGNORES (`describe.skipIf`), jamais simules.
 */
export const INTEGRATION_DB_URL = process.env.TEST_DATABASE_URL ?? ''

/** Vrai si une base d'integration est configuree. */
export const hasIntegrationDb = INTEGRATION_DB_URL.length > 0

let client: PrismaClient | null = null

/** Client Prisma dedie aux tests, pointe sur la base d'integration. */
export function dbClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: INTEGRATION_DB_URL } },
      log: ['warn', 'error'],
    })
  }
  return client
}

/** Ferme le client de test. */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = null
  }
}

/**
 * Vide TOUTES les tables de donnees metier, dans l'ordre respectant les cles
 * etrangeres. Les tables de configuration (`settings`) et d'authentification
 * (`users`, `sessions`) sont aussi videes : chaque suite se construit son propre
 * etat, sans dependre de l'ordre d'execution.
 */
export async function truncateAll(): Promise<void> {
  const db = dbClient()
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "payment_corrections",
      "payments",
      "prescription_items",
      "prescriptions",
      "odontogram_entries",
      "medical_records",
      "documents",
      "treatment_visits",
      "appointment_reschedules",
      "appointments",
      "treatments",
      "trash_entries",
      "activity_logs",
      "login_attempts",
      "password_reset_tokens",
      "sessions",
      "patients",
      "users",
      "settings"
    RESTART IDENTITY CASCADE
  `)
}

/**
 * Verifie que la base de test est bien joignable ET que les migrations ont ete
 * appliquees. Un echec ici doit etre un signal clair, pas une erreur obscure.
 */
export async function verifySchemaReady(): Promise<void> {
  const db = dbClient()
  const lignes = await db.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'payments'
    ) AS present
  `
  if (!lignes[0]?.present) {
    throw new Error(
      "Schema absent dans la base d'integration : appliquez d'abord `prisma migrate deploy`.",
    )
  }
}