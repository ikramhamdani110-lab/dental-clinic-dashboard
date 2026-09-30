import { PrismaClient } from '@prisma/client'

import { getEnv } from '@backend/config/env'
import { logger } from '@backend/logging/logger'

/**
 * =============================================================================
 *  CLIENT PRISMA — INSTANCE UNIQUE
 * =============================================================================
 *
 *  En developpement, Next.js recharge les modules a chaque modification : sans
 *  singleton, chaque rechargement ouvrirait un nouveau pool de connexions, ce
 *  qui epuiserait rapidement la base (« too many clients »). L'instance est donc
 *  stockee sur `globalThis`.
 *
 *  Les requetes sont parametrees par Prisma : aucune concatenation SQL n'est
 *  utilisee dans l'application, ce qui exclut l'injection SQL (§38).
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient(): PrismaClient {
  const env = getEnv()

  return new PrismaClient({
    log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    // Un delai borne evite qu'une requete bloque indefiniment l'interface si la
    // base est momentanement indisponible (§36).
    transactionOptions: {
      maxWait: 5_000,
      timeout: 15_000,
    },
  })
}

/**
 * Instance effective, creee a la premiere utilisation.
 *
 * La creation est PARESSEUSE a dessein : lors du `next build`, Next.js evalue
 * les modules de routes pour collecter leurs metadonnees. Si le client etait
 * cree a l'import, la validation stricte de la configuration (ex. `COOKIE_SECURE`
 * obligatoire en production) s'executerait pendant le build, alors qu'aucune
 * requete n'a lieu — le build echouerait sur une erreur qui n'a de sens qu'a
 * l'execution. La creation a la demande garantit que la validation de la
 * configuration intervient au bon moment : au premier acces reel a la base.
 */
function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient()
  }
  return globalForPrisma.prisma
}

/**
 * Client Prisma utilise par toute l'application.
 *
 * Il s'agit d'un PROXY : chaque acces a une propriete (`prisma.patient`, etc.)
 * declenche la creation du client si necessaire. L'usage reste identique a un
 * `PrismaClient` classique, mais aucun travail n'a lieu au chargement du module.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_cible, propriete, recepteur) {
    return Reflect.get(client(), propriete, recepteur)
  },
  has(_cible, propriete) {
    return propriete in client()
  },
})

/** Resultat du controle de sante, avec la CAUSE precise d'un echec. */
export interface EtatBase {
  healthy: boolean
  latencyMs: number
  /**
   * Cause de l'echec, lorsqu'elle est connue :
   *   - `CONFIGURATION` : la configuration d'environnement est invalide (ex.
   *     COOKIE_SECURE absent en production). La base n'est PAS en cause ;
   *     aucun diagnostic de base ne doit etre entrepris.
   *   - `BASE_INDISPONIBLE` : la base n'a pas repondu.
   *   - `INCONNUE` : echec inattendu.
   */
  cause?: 'CONFIGURATION' | 'BASE_INDISPONIBLE' | 'INCONNUE'
}

/**
 * Verifie que la base repond. Utilise par le point de sante (§37).
 * Ne leve jamais d'exception : renvoie un etat exploitable par le monitoring.
 *
 * POINT IMPORTANT — L'ERREUR DE CONFIGURATION N'EST PAS UNE PANNE DE BASE
 *
 * `getEnv()` LEVE lorsque la configuration est invalide (c'est voulu : demarrer
 * avec une configuration dangereuse serait pire). Auparavant cette exception
 * etait captee avec les autres et presentee comme « base de donnees
 * indisponible » : un deploiement mal configure envoyait donc l'exploitant
 * chercher une panne PostgreSQL inexistante.
 *
 * Les deux verifications sont desormais SEPAREES : la configuration d'abord,
 * la base ensuite. Une erreur de configuration est journalisee avec son message
 * exact — il ne contient jamais de secret, seulement des NOMS de variables.
 */
export async function checkDatabaseHealth(): Promise<EtatBase> {
  const startedAt = Date.now()

  // 1. La configuration est-elle valide ? Si non, la base n'est meme pas
  //    interrogee : le probleme est ailleurs, et le dire evite une fausse piste.
  try {
    getEnv()
  } catch (erreur) {
    logger.error('Configuration invalide : base non interrogee', {
      message: erreur instanceof Error ? erreur.message : String(erreur),
    })
    return { healthy: false, latencyMs: Date.now() - startedAt, cause: 'CONFIGURATION' }
  }

  // 2. La base repond-elle ?
  try {
    await prisma.$queryRaw`SELECT 1`
    return { healthy: true, latencyMs: Date.now() - startedAt }
  } catch (erreur) {
    logger.error('Base de donnees injoignable', { erreur })
    return { healthy: false, latencyMs: Date.now() - startedAt, cause: 'BASE_INDISPONIBLE' }
  }
}
