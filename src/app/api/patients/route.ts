import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { ACTIONS, journaliser } from '@backend/services/activity-log.service'
import { creerPatient, listerPatients } from '@backend/services/patients.service'
import { patientCreationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/patients — liste paginee avec recherche (§9, §26).
 *
 * La recherche porte sur nom, prenom et telephone. Pagination SERVEUR : le
 * navigateur ne recoit qu'une page, jamais l'ensemble des patients.
 *
 * Les patients presents dans la Corbeille sont EXCLUS de la liste et de la
 * recherche, comme pour tous les autres types d'entites (§23).
 */
export const GET = routePrivee(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const recherche = request.nextUrl.searchParams
    const pagination = lirePagination(recherche)
    const terme = recherche.get('recherche') ?? undefined
    const prefix = recherche.get('prefix') ?? undefined
    const triBrut = recherche.get('tri')
    const tri =
      triBrut === 'prenom' || triBrut === 'recent' || triBrut === 'nom' ? triBrut : undefined
    const ordreBrut = recherche.get('ordre')
    const ordre = ordreBrut === 'desc' ? 'desc' : ordreBrut === 'asc' ? 'asc' : undefined

    const resultat = await listerPatients({
      ...(terme ? { recherche: terme } : {}),
      ...(prefix ? { prefix } : {}),
      ...(tri ? { tri } : {}),
      ...(ordre ? { ordre } : {}),
      ...pagination,
    })

    return ok(resultat)
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * POST /api/patients — creation d'un patient (§9).
 * Validee cote serveur ; les champs obligatoires sont nom, prenom, telephone.
 */
export const POST = routePrivee(async (request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)
    const donnees = valider(patientCreationSchema, corps)

    const patient = await creerPatient(donnees)

    await journaliser(contexte.journal, ACTIONS.PATIENT_CREE, {
      entityType: 'Patient',
      entityId: patient.id,
      // Metadonnees NON sensibles : pas de detail medical ici (§24).
      metadata: { nom: patient.nom, prenom: patient.prenom },
    })

    // On ne renvoie PAS l'identifiant comme « identifiant patient » : l'objet
    // complet est retourne, l'interface n'affiche jamais l'ID (§48).
    return ok({ patient }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
