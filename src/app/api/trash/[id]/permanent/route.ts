import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { identifiant } from '@backend/validation/schemas'
import { supprimerDefinitivement } from '@backend/services/trash.service'
import { valider } from '@backend/validation/validate'

/**
 * DELETE /api/trash/:id/permanent — SUPPRESSION DEFINITIVE (§23).
 *
 * Trois garde-fous appliques cote service :
 *   1. La fenetre de 24 h doit etre EC0ULEE : on ne detruit pas un element
 *      encore restaurable par ce chemin (evite une destruction accidentelle).
 *   2. La suppression respecte l'integrite referentielle : un patient ou
 *      traitement portant des paiements ne peut PAS etre detruit (l'historique
 *      financier prime).
 *   3. Un paiement n'est JAMAIS supprime definitivement : il se corrige.
 *
 * L'operation est JOURNALISEE (audit de la suppression definitive).
 */
export const DELETE = routePriveeAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  try {
    const entreeId = valider(identifiant, id)
    await supprimerDefinitivement(entreeId, contexte.journal)
    return ok({ supprimeDefinitivement: true })
  } catch (error) {
    return responseErreur(error)
  }
})
