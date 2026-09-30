import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { listerDocumentsPatient, televerserDocument } from '@backend/services/documents.service'
import { identifiant } from '@backend/validation/schemas'
import { valider } from '@backend/validation/validate'
import { erreurs } from '@backend/errors/app-error'

/** GET /api/patients/:id/documents — documents du patient, PAGINES (§22, §35). */
export const GET = routePriveeAvecId(
  async (request: NextRequest, id): Promise<NextResponse> => {
    try {
      const patientId = valider(identifiant, id)
      const page = await listerDocumentsPatient(
        patientId,
        lirePagination(request.nextUrl.searchParams),
      )
      return ok({
        documents: page.elements,
        total: page.total,
        page: page.page,
        taille: page.taille,
        pages: page.pages,
      })
    } catch (error) {
      return responseErreur(error)
    }
  },
)

/**
 * POST /api/patients/:id/documents — televersement d'un document (§22).
 *
 * Le type REEL du fichier est verifie (signature binaire) cote service :
 * l'extension et l'en-tete du client sont falsifiables et ne sont pas fiables.
 * Le fichier est ecrit hors racine web, sous un nom genere.
 */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)

    const typeContenu = request.headers.get('content-type') ?? ''
    if (!typeContenu.includes('multipart/form-data')) {
      throw erreurs.validation(
        'Le televersement doit etre envoye sous forme de formulaire multipart.',
      )
    }

    const formulaire = await request.formData()
    const fichier = formulaire.get('fichier')
    if (!(fichier instanceof File)) {
      throw erreurs.fichierInvalide('Aucun fichier n’a ete fourni.')
    }

    const categorie = formulaire.get('categorie')
    const description = formulaire.get('description')

    const resultat = await televerserDocument(
      {
        patientId,
        fichier,
        categorie: typeof categorie === 'string' && categorie !== '' ? categorie : null,
        description: typeof description === 'string' && description !== '' ? description : null,
      },
      contexte.journal,
    )

    return ok({ document: resultat }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
