import { type NextRequest, NextResponse } from 'next/server'

import { prisma } from '@backend/database/prisma'
import { erreurs } from '@backend/errors/app-error'
import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { obtenirOrdonnance } from '@backend/services/prescriptions.service'
import { identifiant } from '@backend/validation/schemas'
import { valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/prescriptions/:prescriptionId
 *
 * Feuille complete d'une ordonnance : lignes + en-tete de clinique conserve a
 * la creation + identite du patient (nom, prenom, age). Sert a la visionneuse
 * du dossier et a la reimpression navigateur (A5).
 *
 * Deux identifiants dans l'URL : l'enveloppe `routePriveeAvecId` n'en expose
 * qu'un, la route lit donc ses parametres directement (meme garde-fous :
 * session, role, CSRF inutile en lecture).
 */
export async function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string; prescriptionId: string }> },
): Promise<NextResponse> {
  const { id, prescriptionId } = await route.params

  return routePrivee(async (_requete, contexte) => {
    try {
      const patientId = valider(identifiant, id)
      const cible = valider(identifiant, prescriptionId)

      const ordonnance = await obtenirOrdonnance(cible)
      if (ordonnance.patientId !== patientId) {
        // L'ordonnance existe mais appartient a un autre patient : 404, jamais
        // 403, pour ne pas reveler l'existence d'un enregistrement etranger.
        throw erreurs.introuvable('Ordonnance')
      }

      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        select: { nom: true, prenom: true, age: true },
      })
      if (!patient) throw erreurs.introuvable('Patient')

      void contexte
      return ok({ ordonnance, patient })
    } catch (error) {
      return responseErreur(error)
    }
  })(request)
}
