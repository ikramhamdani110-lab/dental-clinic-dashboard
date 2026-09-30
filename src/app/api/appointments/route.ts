import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import {
  creerRendezVous,
  creerRendezVousDepuisFormulaire,
  detecterConflit,
  listerRendezVous,
  messageConflit,
} from '@backend/services/appointments.service'
import {
  rendezVousCreationSchema,
  rendezVousFormCreationSchema,
  statutRendezVousSchema,
} from '@backend/validation/schemas'
import { erreurs } from '@backend/errors/app-error'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/appointments — planning filtre (§14, §26).
 *
 * Filtres : periode (`du` / `au`), patient, statut, recherche patient.
 * Pagination serveur : jamais toute la table dans le navigateur.
 */
export const GET = routePrivee(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const params = request.nextUrl.searchParams
    const pagination = lirePagination(params)

    const du = params.get('du')
    const au = params.get('au')
    const statutBrut = params.get('statut')
    const patientId = params.get('patientId')
    const recherche = params.get('recherche')

    const statut = statutBrut ? valider(statutRendezVousSchema, statutBrut) : undefined

    const resultat = await listerRendezVous({
      ...pagination,
      ...(du ? { dateDebut: new Date(du) } : {}),
      ...(au ? { dateFin: new Date(au) } : {}),
      ...(statut ? { statut } : {}),
      ...(patientId ? { patientId } : {}),
      ...(recherche ? { recherche } : {}),
    })

    return ok(resultat)
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * POST /api/appointments — creation d'un rendez-vous (§14).
 *
 * Un CONFLIT de planning est detecte AVANT enregistrement : deux rendez-vous ne
 * peuvent pas se chevaucher. Le message renvoye nomme le rendez-vous fautif.
 */
export const POST = routePrivee(async (request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)

    if (typeof corps === 'object' && corps !== null && 'date' in corps) {
      const donnees = valider(rendezVousFormCreationSchema, corps)
      const resultat = await creerRendezVousDepuisFormulaire(donnees, contexte.journal)
      return ok({ rendezVous: resultat }, { status: resultat.dejaEnregistre ? 200 : 201 })
    }

    const donnees = valider(rendezVousCreationSchema, corps)

    // Verification de conflit explicite afin de renvoyer un message detaillE
    // (nom du patient, horaires) plutot qu'un simple refus.
    const conflit = await detecterConflit({
      dateDebut: donnees.dateDebut,
      dateFin: donnees.dateFin,
    })
    if (conflit.enConflit && conflit.rendezVous) {
      throw erreurs.rendezVousEnConflit(messageConflit(conflit.rendezVous))
    }

    const rendezVous = await creerRendezVous(
      {
        patientId: donnees.patientId,
        dateDebut: donnees.dateDebut,
        dateFin: donnees.dateFin,
        treatmentId: donnees.treatmentId ?? null,
        dents: donnees.dents,
        motif: donnees.motif,
        notes: donnees.notes,
        statut: donnees.statut,
      },
      contexte.journal,
    )

    return ok({ rendezVous }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
