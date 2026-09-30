'use client'

import { NotificationsProvider } from '@/components/ui/notifications'
import { ThemeProvider } from '@/components/ui/theme-provider'

/**
 * Fournisseurs client du tableau de bord : theme et notifications.
 *
 * Ce composant est un point d'assemblage unique, ce qui evite de repeter les
 * fournisseurs dans chaque page privee.
 *
 * La coquille (barre laterale + entete) est appliquee par chaque page, car le
 * titre de l'entete depend de la page affichee.
 */
export function FournisseurTableauBord({
  children,
}: {
  utilisateur: { nomAffichage: string; email: string }
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <ThemeProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </ThemeProvider>
  )
}
