import type { ButtonHTMLAttributes, ReactNode } from 'react'

import Link from 'next/link'

/**
 * =============================================================================
 *  BOUTONS
 * =============================================================================
 *
 *  Variantes sobres : principal, secondaire, discret, danger. Les boutons
 *  portent toujours un etat `disabled` EXPLICITE quand une action est en cours
 *  (cela empeche le double envoi, en complement de l'idempotence serveur).
 */

export type VarianteBouton = 'principal' | 'secondaire' | 'discret' | 'danger' | 'danger-plein'

interface ProprietesBouton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBouton
  taille?: 'normale' | 'petite'
  children: ReactNode
}

function classes(variante: VarianteBouton, taille: 'normale' | 'petite'): string {
  return ['bouton', `bouton-${variante}`, taille === 'petite' ? 'bouton-petit' : '']
    .filter(Boolean)
    .join(' ')
}

export function Bouton({
  variante = 'secondaire',
  taille = 'normale',
  className,
  children,
  ...restantes
}: ProprietesBouton): React.JSX.Element {
  return (
    <button
      className={[classes(variante, taille), className].filter(Boolean).join(' ')}
      {...restantes}
    >
      {children}
    </button>
  )
}

interface ProprietesLienBouton {
  href: string
  variante?: VarianteBouton
  taille?: 'normale' | 'petite'
  className?: string
  children: ReactNode
}

/** Lien presentant l'apparence d'un bouton (navigation). */
export function LienBouton({
  href,
  variante = 'secondaire',
  taille = 'normale',
  className,
  children,
}: ProprietesLienBouton): React.JSX.Element {
  return (
    <Link href={href} className={[classes(variante, taille), className].filter(Boolean).join(' ')}>
      {children}
    </Link>
  )
}
