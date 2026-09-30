import { z } from 'zod'

import { erreurs } from '@backend/errors/app-error'
import { versErreursChamps } from '@backend/validation/schemas'

/**
 * =============================================================================
 *  POINT D'ENTREE UNIQUE DE LA VALIDATION (§33)
 * =============================================================================
 *
 *  Toute donnee entrante traverse `valider`. En cas d'echec, une `AppError`
 *  francaise est levee, avec les champs fautifs : l'interface peut alors
 *  positionner chaque message sous le bon champ.
 *
 *  Aucune trace de validation technique (type Zod, chemin interne) n'est
 *  transmise au client.
 */

export function valider<T extends z.ZodTypeAny>(schema: T, donnees: unknown): z.infer<T> {
  const resultat = schema.safeParse(donnees)

  if (!resultat.success) {
    const champs = versErreursChamps(resultat.error)
    throw erreurs.validation(
      'Certaines informations saisies sont invalides. Verifiez les champs signales.',
      champs,
    )
  }

  return resultat.data
}

/** Lit un corps JSON de requete en capturant les corps malformes. */
export async function lireCorpsJson(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) {
    throw erreurs.validation('Le corps de la requete doit etre au format JSON.')
  }
  try {
    return await request.json()
  } catch {
    throw erreurs.validation('Le corps de la requete est illisible.')
  }
}

/** Lit un corps de formulaire (multipart) en capturant les erreurs. */
export async function lireFormData(request: Request): Promise<FormData> {
  const type = request.headers.get('content-type') ?? ''
  if (!type.includes('multipart/form-data')) {
    throw erreurs.validation('Le corps de la requete doit etre un formulaire multipart.')
  }
  try {
    return await request.formData()
  } catch {
    throw erreurs.validation('Le formulaire est illisible.')
  }
}
