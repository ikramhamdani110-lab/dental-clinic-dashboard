'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { t } from '@content/index'

/**
 * =============================================================================
 *  NOTIFICATIONS (TOASTS)
 * =============================================================================
 *
 *  Notifications sobres et professionnelles : un bandeau, un message, une
 *  fermeture. Aucune animation excessive, aucune couleur neon.
 *
 *  ACCESSIBILITE : la zone est un `region` avec `aria-live="polite"`, ce qui
 *  permet aux lecteurs d'ecran d'annoncer un message sans interrompre l'action
 *  en cours.
 */

export type TypeNotification = 'succes' | 'erreur' | 'avertissement' | 'information'

interface Notification {
  id: string
  type: TypeNotification
  message: string
}

interface NotificationsContextValue {
  notifier: (type: TypeNotification, message: string) => void
  succes: (message: string) => void
  erreur: (message: string) => void
  avertissement: (message: string) => void
  information: (message: string) => void
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

/** Duree d'affichage selon la gravite : une erreur reste plus longtemps. */
const DUREE_MS: Record<TypeNotification, number> = {
  succes: 4000,
  information: 4500,
  avertissement: 6000,
  erreur: 8000,
}

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [notifications, setNotifications] = useState<Notification[]>([])

  const retirer = useCallback((id: string) => {
    setNotifications((precedentes) => precedentes.filter((notification) => notification.id !== id))
  }, [])

  const notifier = useCallback(
    (type: TypeNotification, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setNotifications((precedentes) => [...precedentes, { id, type, message }])
      window.setTimeout(() => retirer(id), DUREE_MS[type])
    },
    [retirer],
  )

  const valeur = useMemo<NotificationsContextValue>(
    () => ({
      notifier,
      succes: (message) => notifier('succes', message),
      erreur: (message) => notifier('erreur', message),
      avertissement: (message) => notifier('avertissement', message),
      information: (message) => notifier('information', message),
    }),
    [notifier],
  )

  return (
    <NotificationsContext.Provider value={valeur}>
      {children}
      <div
        className="zone-notifications"
        role="region"
        aria-live="polite"
        aria-label={t('notifications.information')}
      >
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`notification notification-${notification.type}`}
            role={notification.type === 'erreur' ? 'alert' : 'status'}
          >
            <span className="notification-texte">{notification.message}</span>
            <button
              type="button"
              className="bouton-fermer-modale"
              onClick={() => retirer(notification.id)}
              aria-label={t('notifications.fermer')}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  )
}

export function useNotifications(): NotificationsContextValue {
  const contexte = useContext(NotificationsContext)
  if (!contexte) {
    throw new Error('useNotifications doit etre utilise a l’interieur de NotificationsProvider.')
  }
  return contexte
}
