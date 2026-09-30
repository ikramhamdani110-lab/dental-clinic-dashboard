import { NextResponse } from 'next/server'

import { responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { lireDocument } from '@backend/services/documents.service'
import { identifiant } from '@backend/validation/schemas'
import { valider } from '@backend/validation/validate'

/**
 * GET /api/documents/:id/download — sert le contenu d'un document (§22).
 *
 * ROUTE PRIVEE : l'authentification est exigee AVANT toute lecture du disque.
 * Un utilisateur non authentifie ne peut PAS atteindre le fichier, meme en
 * connaissant son identifiant : il n'existe aucune URL publique previsible.
 *
 * Le contenu est servi en `attachment` avec `X-Content-Type-Options: nosniff`,
 * ce qui evite qu'un fichier piege ne soit interprete comme du HTML par le
 * navigateur (XSS via document).
 */
export const GET = routePriveeAvecId(async (_request, id): Promise<NextResponse> => {
  try {
    const documentId = valider(identifiant, id)
    const { contenu, mimeType, nomOriginal } = await lireDocument(documentId)

    return new NextResponse(new Uint8Array(contenu), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(contenu.length),
        // Telechargement force : le navigateur n'execute jamais le contenu.
        'Content-Disposition': `attachment; filename="${encodeurNomFichier(nomOriginal)}"`,
        'X-Content-Type-Options': 'nosniff',
        // Un document patient n'est jamais mis en cache par un intermediaire.
        'Cache-Control': 'no-store, private, max-age=0',
      },
    })
  } catch (error) {
    return responseErreur(error)
  }
})

/** Encode un nom de fichier pour l'en-tete Content-Disposition. */
function encodeurNomFichier(nom: string): string {
  // Les caracteres hors ASCII sont remplaces : un nom non conforme casserait
  // l'en-tete HTTP.
  return nom.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'")
}
