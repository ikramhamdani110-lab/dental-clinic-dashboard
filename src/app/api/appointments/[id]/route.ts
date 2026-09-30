import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { prisma } from '@backend/database/prisma'
import { erreurs } from '@backend/errors/app-error'
import {
  historiqueReprogrammations,
  modifierRendezVous,
} from '@backend/services/appointments.service'
import { mettreEnCorbeille } from '@backend/services/trash.service'
import { identifiant, rendezVousModificationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/** GET /api/appointments/:id — rendez-vous et son historique de reprogrammation. */
export const GET = routePriveeAvecId(async (_request, id): Promise<NextResponse> => {
  try {
    const rendezVousId = valider(identifiant, id)
    const rendezVous = await prisma.appointment.findUnique({
      where: { id: rendezVousId },
      include: { patient: { select: { nom: true, prenom: true, telephone: true } } },
    })
    if (!rendezVous) throw erreurs.introuvable('Rendez-vous')

    const historique = await historiqueReprogrammations(rendezVousId)

    return ok({
      rendezVous: {
        id: rendezVous.id,
        patientId: rendezVous.patientId,
        patient: rendezVous.patient,
        dateDebut: rendezVous.dateDebut,
        dateFin: rendezVous.dateFin,
        motif: rendezVous.motif,
        notes: rendezVous.notes,
        statut: rendezVous.statut,
        motifStatut: rendezVous.motifStatut,
        treatmentId: rendezVous.treatmentId,
        dents: JSON.parse(rendezVous.dents) as string[],
      },
      historiqueReprogrammations: historique,
    })
  } catch (error) {
    return responseErreur(error)
  }
})

/** PUT /api/appointments/:id — modification (les changements d'horaire sont historises). */
export const PUT = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const rendezVousId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(rendezVousModificationSchema, corps)

    await modifierRendezVous(rendezVousId, donnees, contexte.journal)
    return ok({ modifie: true })
  } catch (error) {
    return responseErreur(error)
  }
})

/** DELETE /api/appointments/:id — mise en Corbeille (24 h). */
export const DELETE = routePriveeAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  try {
    const rendezVousId = valider(identifiant, id)
    const resultat = await mettreEnCorbeille('RENDEZ_VOUS', rendezVousId, contexte.journal)
    return ok({ corbeille: { expireLe: resultat.expireLe.toISOString() } })
  } catch (error) {
    return responseErreur(error)
  }
})
