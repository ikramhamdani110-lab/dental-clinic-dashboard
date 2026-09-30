import { cookies } from 'next/headers'

import { SESSION_COOKIE_NAME, resolveSession } from '@backend/auth/session'

import { EnTetePage } from '@/components/layout/en-tete-page'

/**
 * Enveloppe d'une page privee (composant SERVEUR).
 *
 * Elle rend le TITRE de la page et son contenu. La COQUILLE (rail de navigation
 * + zone de contenu) n'est plus rendue ici : elle appartient a la mise en page du
 * groupe \`(dashboard)\`, qui persiste d'une page a l'autre.
 *
 * POURQUOI CE DECOUPAGE
 *
 *  Lorsque la coquille etait rendue par chaque page, elle etait demontee et
 *  remontee a chaque navigation : le rail disparaissait puis reapparaissait, et
 *  un clic sur une icone tombant pendant ce demontage etait perdu. En confiant la
 *  coquille a la mise en page, seul le CONTENU de la page est remplace : le rail
 *  reste en place, donc cliquable a tout instant.
 *
 * La session est deja validee par la mise en page : ici, on ne fait que LIRE
 * l'affichage de l'utilisateur. Si elle disparaissait entre la mise en page et la
 * page (cas tres rare), on retombe sur un libelle neutre plutot que de faire
 * echouer le rendu.
 */
export async function PagePrivee({
  titre,
  children,
}: {
  titre: string
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  const magasinCookies = await cookies()
  const session = await resolveSession(magasinCookies.get(SESSION_COOKIE_NAME)?.value)

  const utilisateur = session
    ? { nomAffichage: session.user.displayName, email: session.user.email }
    : { nomAffichage: '—', email: '' }

  return (
    <>
      <EnTetePage titre={titre} utilisateur={utilisateur} />
      {children}
    </>
  )
}
