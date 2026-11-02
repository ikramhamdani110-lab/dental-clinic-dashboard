import { type NextRequest, NextResponse } from 'next/server'

import { routeFinanciere } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import {
  creerTransactionPersonnelle,
  listerTransactionsPersonnelles,
} from '@backend/services/transactions-personnelles.service'
import { transactionPersonnelleCreationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/finances/personal-transactions — liste paginee des transactions
 * personnelles du medecin.
 *
 * Filtres : `du`, `au`, `nature` (REVENUE | DEPENSE | DETTE_PERSONNELLE),
 * `page`, `taille`.
 */
export const GET = routeFinanciere(async (request: NextRequest): Promise<NextResponse> => {
  const params = request.nextUrl.searchParams
  const du = params.get('du')
  const au = params.get('au')
  const nature = params.get('nature')
  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1
  const taille = Number.parseInt(params.get('taille') ?? '25', 10) || 25

  const resultat = await listerTransactionsPersonnelles({
    ...(du ? { debut: new Date(`${du}T00:00:00`) } : {}),
    ...(au ? { fin: new Date(`${au}T23:59:59.999`) } : {}),
    ...(nature ? { nature } : {}),
    page,
    taille,
  })

  return ok(resultat)
})

/**
 * POST /api/finances/personal-transactions — cree une transaction personnelle.
 *
 * ANTI-DOUBLON : la cle `idempotencyKey` est UNIQUE en base (meme mecanisme
 * que les paiements et les revenus manuels du cabinet).
 *
 * NOTE IMPORTANT rappelée au médecin à l'écran : une transaction personnelle
 * n'apparaît JAMAIS dans les totaux du cabinet (paiements reçus, dettes
 * patients, dépenses du cabinet). C'est un espace strictement séparé.
 */
export const POST = routeFinanciere(async (request: NextRequest, contexte): Promise<NextResponse> => {
  const corps = await lireCorpsJson(request)
  const donnees = valider(transactionPersonnelleCreationSchema, corps)

  const resultat = await creerTransactionPersonnelle(
    {
      montantCentimes: donnees.montantCentimes,
      nature: donnees.nature,
      direction: donnees.direction ?? null,
      titre: donnees.titre,
      date: donnees.date,
      note: donnees.note ?? null,
      idempotencyKey: donnees.idempotencyKey,
    },
    contexte.journal,
  )

  return ok(resultat, { status: resultat.dejaEnregistre ? 200 : 201 })
})
