import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { parseMontantEnCentimes } from '@backend/domain/finance'
import { ajouterPaiement, listerPaiements } from '@backend/services/payments.service'
import {
  methodePaiementSchema,
  paiementCreationSchema,
  statutPaiementSchema,
} from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/payments — liste paginee des paiements (§16, §26).
 *
 * Filtres : patient, traitement, methode, statut, intervalle de dates,
 * intervalle de montant. La pagination est serveur.
 *
 * Le filtre `methode` reste accepte par l'API (compatibilite ascendante) mais
 * n'est plus expose dans l'interface (§16).
 */
export const GET = routePrivee(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const params = request.nextUrl.searchParams
    const pagination = lirePagination(params)

    const methodeBrute = params.get('methode')
    const statutBrut = params.get('statut')
    const montantMin = params.get('montantMin')
    const montantMax = params.get('montantMax')
    const du = params.get('du')
    const au = params.get('au')

    const resultat = await listerPaiements({
      ...pagination,
      ...(params.get('patientId') ? { patientId: params.get('patientId') as string } : {}),
      ...(params.get('treatmentId') ? { treatmentId: params.get('treatmentId') as string } : {}),
      ...(methodeBrute ? { methode: valider(methodePaiementSchema, methodeBrute) } : {}),
      ...(statutBrut ? { statut: valider(statutPaiementSchema, statutBrut) } : {}),
      ...(du ? { du: new Date(du) } : {}),
      ...(au ? { au: new Date(au) } : {}),
      ...(montantMin ? { montantMinCentimes: parseMontantEnCentimes(montantMin) ?? 0 } : {}),
      ...(montantMax
        ? { montantMaxCentimes: parseMontantEnCentimes(montantMax) ?? Number.MAX_SAFE_INTEGER }
        : {}),
      ...(params.get('recherche') ? { recherche: params.get('recherche') as string } : {}),
    })

    return ok(resultat)
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * POST /api/payments — enregistre un paiement (§16, §17).
 *
 * DEUX PROTECTIONS FONDAMENTALES :
 *   - `idempotencyKey` (obligatoire) : une cle deja utilisee ne cree pas de
 *     second paiement, elle renvoie le premier. Fin de la double soumission.
 *   - Controle du depassement : le paiement est refuse s'il ferait depasser le
 *     prix total du traitement (verifie dans une transaction cote service).
 *
 * La reponse indique le RESTE A PAYER apres enregistrement, calcule en base.
 */
export const POST = routePrivee(async (request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)
    const donnees = valider(paiementCreationSchema, corps)

    const resultat = await ajouterPaiement(
      {
        patientId: donnees.patientId,
        treatmentId: donnees.treatmentId,
        treatmentVisitId: donnees.treatmentVisitId ?? null,
        montantCentimes: donnees.montantCentimes,
        datePaiement: donnees.datePaiement,
        // La methode n'est plus demandee par l'interface (§16). Si un client
        // l'omet, le service applique la valeur par defaut du schema.
        ...(donnees.methode ? { methode: donnees.methode } : {}),
        notes: donnees.notes,
        idempotencyKey: donnees.idempotencyKey,
      },
      contexte.journal,
    )

    return ok(
      {
        paiement: { id: resultat.id },
        resteAPayerCentimes: resultat.resteAPayerCentimes,
        dejaEnregistre: resultat.dejaEnregistre,
      },
      { status: resultat.dejaEnregistre ? 200 : 201 },
    )
  } catch (error) {
    return responseErreur(error)
  }
})
