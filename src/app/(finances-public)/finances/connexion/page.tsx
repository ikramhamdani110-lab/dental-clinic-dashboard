import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import {
  FINANCE_SESSION_COOKIE_NAME,
  resoudreSessionFinanciere,
} from '@backend/auth/finance-session'

import { cookies } from 'next/headers'

import { FormulaireConnexionFinanciere } from '@/components/finances/formulaire-connexion-financiere'

/**
 * Page de connexion au site financier privé — VERSION MINIMALE (§finances-v7).
 *
 * Trois éléments, rien d'autre : Email, Mot de passe, bouton Connecter.
 * Aucun logo, nom de clinique, titre, sous-titre, description ni notice.
 *
 * PUBLIC PAR NÉCESSITÉ (porte d'entrée) mais STRICTEMENT SANS INSCRIPTION :
 * seul le compte MEDECIN existant peut ouvrir une session. La page reste
 * `noindex`. Un médecin déjà connecté est redirigé vers le tableau de bord.
 */
export const metadata: Metadata = {
  title: 'Finances privées',
  robots: { index: false, follow: false },
}

export default async function PageConnexionFinanciere(): Promise<React.JSX.Element> {
  const magasinCookies = await cookies()
  const jeton = magasinCookies.get(FINANCE_SESSION_COOKIE_NAME)?.value
  const session = await resoudreSessionFinanciere(jeton)

  if (session) {
    redirect('/finances')
  }

  return (
    <main className="finances-connexion">
      <div className="finances-connexion-carte">
        <FormulaireConnexionFinanciere />
      </div>
    </main>
  )
}
