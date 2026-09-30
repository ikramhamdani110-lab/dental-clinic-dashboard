import { NextResponse } from 'next/server'

import { checkDatabaseHealth } from '@backend/database/prisma'

/**
 * GET /api/health
 *
 * Point de sante pour le monitoring et l'orchestrateur (§37).
 *
 * SECURITE : aucune information d'infrastructure n'est exposee (pas de version
 * de base, pas d'hote, pas de chaine de connexion, pas de detail d'erreur). Le
 * reponse indique seulement si l'application et sa base sont operationnelles.
 *
 * Renvoie 200 lorsque tout va bien, 503 sinon : un orchestrateur peut ainsi
 * retirer une instance defaillante du service.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const base = await checkDatabaseHealth()
  const operationnel = base.healthy

  return NextResponse.json(
    {
      statut: operationnel ? 'operationnel' : 'degrade',
      service: 'api',
      // « indisponible » serait TROMPEUR lorsque la base se porte bien : une
      // configuration invalide empeche de l'interroger, mais ce n'est pas une
      // panne de base. Les deux cas sont donc distingues, sans reveler ni
      // valeur de configuration ni detail d'infrastructure.
      baseDeDonnees: base.healthy
        ? 'accessible'
        : base.cause === 'CONFIGURATION'
          ? 'non interrogee (configuration invalide)'
          : 'indisponible',
      horodatage: new Date().toISOString(),
    },
    { status: operationnel ? 200 : 503 },
  )
}
