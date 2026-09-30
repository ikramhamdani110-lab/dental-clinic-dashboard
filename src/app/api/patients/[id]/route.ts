import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { ACTIONS, journaliser } from '@backend/services/activity-log.service'
import {
  calculerSoldePatient,
  modifierPatient,
  obtenirPatient,
} from '@backend/services/patients.service'
import { mettreEnCorbeille } from '@backend/services/trash.service'
import { identifiant, patientModificationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * L'identifiant de route est valide comme UUID cote serveur AVANT tout acces
 * base : un identifiant malforme produit une erreur 422 francaise, jamais une
 * erreur technique.
 */

/**
 * GET /api/patients/:id — fiche complete d'un patient, avec son solde.
 *
 * L'identifiant est un UUID interne. Il apparait dans l'URL mais n'est JAMAIS
 * affiche comme un « numero de patient » a l'ecran (§48) : l'interface montre
 * toujours le nom, le prenom et le telephone.
 */
export const GET = routePriveeAvecId(async (_request, id): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)
    const [patient, solde] = await Promise.all([
      obtenirPatient(patientId),
      calculerSoldePatient(patientId),
    ])
    return ok({ patient, solde })
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * PUT /api/patients/:id — modification de la fiche administrative.
 *
 * PRINCIPE HISTORIQUE (§11) : cette modification ne touche que les informations
 * d'identification. Elle ne reecrit JAMAIS un rendez-vous, un traitement, un
 * paiement ou un dossier medical deja enregistres.
 */
export const PUT = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(patientModificationSchema, corps)

    const patient = await modifierPatient(patientId, donnees)

    await journaliser(contexte.journal, ACTIONS.PATIENT_MODIFIE, {
      entityType: 'Patient',
      entityId: patient.id,
      metadata: { champsModifies: Object.keys(donnees) },
    })

    return ok({ patient })
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * DELETE /api/patients/:id — mise en CORBEILLE (suppression logique).
 *
 * L'element disparait des vues normales mais reste 24 heures en Corbeille (§23).
 * Aucune donnee liee n'est detruite.
 */
export const DELETE = routePriveeAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)
    // Verification d'existence pour un message clair.
    await obtenirPatient(patientId)

    const resultat = await mettreEnCorbeille('PATIENT', patientId, contexte.journal)
    return ok({ corbeille: { expireLe: resultat.expireLe.toISOString() } })
  } catch (error) {
    return responseErreur(error)
  }
})
