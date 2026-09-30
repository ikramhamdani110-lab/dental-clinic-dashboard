import { useEffect, useRef, useState } from 'react'
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

import { t } from '@content/index'

/**
 * =============================================================================
 *  CHAMPS DE FORMULAIRE
 * =============================================================================
 *
 *  Chaque champ porte une ETIQUETTE liee (`htmlFor` / `id`) : c'est une exigence
 *  d'accessibilite, pas une option. Les messages d'erreur sont references par
 *  `aria-describedby` et signales par `aria-invalid`, afin que les lecteurs
 *  d'ecran les associent au bon champ.
 *
 *  L'indicateur « obligatoire » est a la fois visuel (`*`) et semantique
 *  (`aria-required`).
 */

export function genererId(nom: string): string {
  return `champ-${nom}`
}

interface ProprietesCommunes {
  nom: string
  etiquette: string
  erreur?: string
  aide?: string
  obligatoire?: boolean
  /**
   * Mettre `true` pour NE PAS emettre l'attribut `name` sur le controle.
   *
   * Un champ sans `name` n'est pas serialisable par le navigateur : il ne peut
   * donc pas apparaitre dans une query string ni dans le corps d'une soumission
   * HTML native. Utilise pour les champs sensibles (mot de passe) afin qu'une
   * panne de JavaScript ne puisse pas faire fuiter la valeur dans l'URL.
   */
  sansNom?: boolean
}

interface ProprietesTexte
  extends ProprietesCommunes,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'id'> {}

export function ChampTexte({
  nom,
  etiquette,
  erreur,
  aide,
  obligatoire,
  sansNom = false,
  ...restantes
}: ProprietesTexte): React.JSX.Element {
  const id = genererId(nom)
  const idsDescription: string[] = []
  if (aide) idsDescription.push(`${id}-aide`)
  if (erreur) idsDescription.push(`${id}-erreur`)

  return (
    <div className="champ">
      <label htmlFor={id} className={`champ-etiquette${obligatoire ? ' champ-obligatoire' : ''}`}>
        {etiquette}
      </label>
      <input
        id={id}
        name={sansNom ? undefined : nom}
        className="champ-controle"
        autoComplete="off"
        aria-invalid={erreur ? 'true' : undefined}
        aria-describedby={idsDescription.length > 0 ? idsDescription.join(' ') : undefined}
        aria-required={obligatoire ? 'true' : undefined}
        {...restantes}
      />
      {aide ? (
        <span className="champ-aide" id={`${id}-aide`}>
          {aide}
        </span>
      ) : null}
      {erreur ? (
        <span className="champ-erreur" id={`${id}-erreur`} role="alert">
          {erreur}
        </span>
      ) : null}
    </div>
  )
}

/**
 * =============================================================================
 *  CHAMP DATE — SAISIE LIBRE JJ/MM/AAAA (AJOUT, PAS REMPLACEMENT)
 * =============================================================================
 *
 *  POURQUOI CE COMPOSANT EXISTE
 *
 *  L'input natif `type="date"` ne se pilote pas au clavier de facon fiable dans un
 *  navigateur francise : chaque segment affiche ses propres separateurs, la
 *  frappe est interceptee par le navigateur, et le composant CONTROLE force un
 *  re-rendu a chaque `onChange`. Concretement, l'utilisateur voit des chiffres
 *  disparaitre, le curseur sauter, ou la saisie etre rejetee au milieu du chemin.
 *
 *  Le comportement retenu ici est donc celui d'un CHAMP DE TEXTE :
 *
 *    - l'etat du parent contient la FRAPPE BRUTE (`jjmmaaaa` ou `jj/mm/aaaa`) ;
 *    - la valeur affichee est exactement la frappe : rien n'est reformate, rien
 *      n'est tronque, le curseur ne bouge pas ;
 *    - la conversion vers `aaaa-mm-jj` n'a lieu qu'a la SORTIE du champ
 *      (`onBlur`), donc jamais pendant la frappe ;
 *    - Backspace, Delete, selection et collage fonctionnent naturellement, dans
 *      n'importe quel segment, car le champ est un `<input type="text">` ;
 *    - les deux champs ne partagent aucun etat : taper dans « Du » ne peut pas
 *      toucher « Au ».
 *
 *  AUCUN DECALAGE DE FUSEAU : `aaaa-mm-jj` est une date SANS heure, interpretee
 *  par `new Date(iso)` en heure locale UTC. Aucune conversion UTC n'est
 *  appliquee, donc aucun jour ne peut « glisser » d'un jour.
 */

const LONGUEUR_DATE = 8

/** Uniquement des chiffres : les separateurs sont normalises a la sortie. */
function seulementChiffres(valeur: string): string {
  return valeur.replace(/\D/g, '').slice(0, LONGUEUR_DATE)
}

/**
 * `12345678` ou `12/34/5678` → `12/34/5678`.
 * Utilise a la sortie du champ : c'est le SEUL endroit ou l'affichage est
 * reecrit, donc jamais en plein milieu d'une frappe.
 */
function formatFr(valeurBrute: string): string {
  const chiffres = seulementChiffres(valeurBrute)
  if (chiffres.length <= 2) return chiffres
  if (chiffres.length <= 4) return `${chiffres.slice(0, 2)}/${chiffres.slice(2)}`
  return `${chiffres.slice(0, 2)}/${chiffres.slice(2, 4)}/${chiffres.slice(4)}`
}

/**
 * `12/03/2026` → `2026-03-12`, ou `null` si la date est incomplete ou
 * inexistante (32/01/2026, 2026 sans jour…). Aucune conversion de fuseau.
 */
function versIso(valeurBrute: string): string | null {
  const chiffres = seulementChiffres(valeurBrute)
  if (chiffres.length !== LONGUEUR_DATE) return null
  const jour = Number.parseInt(chiffres.slice(0, 2), 10)
  const mois = Number.parseInt(chiffres.slice(2, 4), 10)
  const annee = Number.parseInt(chiffres.slice(4), 10)
  if (mois < 1 || mois > 12 || jour < 1 || annee < 1900 || annee > 2999) return null
  // Le 31/02/2026 doit etre refuse : on verifie que le jour existe dans le mois.
  if (jour > joursDansLeMois(annee, mois)) return null
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

/** `2026-03-12` → `12/03/2026`, pour l'affichage initial d'une valeur deja connue. */
function depuisIso(iso: string): string {
  const correspond = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!correspond) return ''
  return formatFr(`${correspond[3]}${correspond[2]}${correspond[1]}`)
}

function joursDansLeMois(annee: number, mois: number): number {
  return new Date(annee, mois, 0).getDate()
}

export interface ChampDateProps {
  nom: string
  etiquette: string
  /** Date au format ISO `aaaa-mm-jj`, ou chaine vide. */
  valeur: string
  onChangeIso: (iso: string) => void
  aide?: string
  erreur?: string
  requis?: boolean
}

export function ChampDate({
  nom,
  etiquette,
  valeur,
  onChangeIso,
  aide,
  erreur,
  requis = false,
}: ChampDateProps): React.JSX.Element {
  const id = genererId(nom)
  // La frappe vit ICI (etat local, independant du parent) : le parent ne reçoit
  // une nouvelle valeur qu'a la sortie du champ. Aucune frappe concurrente ne
  // peut donc remplacer ce que l'utilisateur est en train de taper.
  const [frappe, setFrappe] = useState(() => depuisIso(valeur))
  const [erreurLocale, setErreurLocale] = useState<string | null>(null)
  const sortieEnCours = useRef(false)

  // Si la valeur du parent change APRES la sortie du champ (reset du formulaire,
  // changement de periode), l'affichage suit — mais jamais pendant la frappe.
  useEffect(() => {
    if (sortieEnCours.current) {
      sortieEnCours.current = false
      return
    }
    setFrappe(depuisIso(valeur))
  }, [valeur])

  const idsDescription: string[] = []
  if (aide) idsDescription.push(`${id}-aide`)
  const messageErreur = erreur ?? erreurLocale
  if (messageErreur) idsDescription.push(`${id}-erreur`)

  return (
    <div className="champ">
      <label htmlFor={id} className={`champ-etiquette${requis ? ' champ-obligatoire' : ''}`}>
        {etiquette}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        name={nom}
        className="champ-controle"
        placeholder="jj/mm/aaaa"
        autoComplete="off"
        value={frappe}
        aria-invalid={messageErreur ? 'true' : undefined}
        aria-describedby={idsDescription.length > 0 ? idsDescription.join(' ') : undefined}
        aria-required={requis ? 'true' : undefined}
        // Frappe : on ne conserve que les chiffres, on ne remet JAMAIS en forme.
        onChange={(evenement) => {
          setErreurLocale(null)
          setFrappe(seulementChiffres(evenement.target.value))
        }}
        // Sortie : la seule occasion de reformater et de valider.
        onBlur={() => {
          const iso = versIso(frappe)
          if (frappe === '') {
            sortieEnCours.current = true
            setErreurLocale(null)
            onChangeIso('')
            return
          }
          sortieEnCours.current = true
          setFrappe(formatFr(frappe))
          if (iso === null) {
            setErreurLocale(t('commun.dateInvalide'))
            return
          }
          onChangeIso(iso)
        }}
        onKeyDown={(evenement) => {
          // `Entrée` valide sans avoir a_losses le focus : meme comportement que
          // la sortie de champ, donc pas de double traitement.
          if (evenement.key === 'Enter') {
            evenement.currentTarget.blur()
          }
        }}
      />
      {aide ? (
        <span className="champ-aide" id={`${id}-aide`}>
          {aide}
        </span>
      ) : null}
      {messageErreur ? (
        <span className="champ-erreur" id={`${id}-erreur`} role="alert">
          {messageErreur}
        </span>
      ) : null}
    </div>
  )
}

interface ProprietesZone
  extends ProprietesCommunes,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name' | 'id'> {}

export function ChampZone({
  nom,
  etiquette,
  erreur,
  aide,
  obligatoire,
  ...restantes
}: ProprietesZone): React.JSX.Element {
  const id = genererId(nom)
  const idsDescription: string[] = []
  if (aide) idsDescription.push(`${id}-aide`)
  if (erreur) idsDescription.push(`${id}-erreur`)

  return (
    <div className="champ">
      <label htmlFor={id} className={`champ-etiquette${obligatoire ? ' champ-obligatoire' : ''}`}>
        {etiquette}
      </label>
      <textarea
        id={id}
        name={nom}
        className="champ-controle"
        autoComplete="off"
        aria-invalid={erreur ? 'true' : undefined}
        aria-describedby={idsDescription.length > 0 ? idsDescription.join(' ') : undefined}
        aria-required={obligatoire ? 'true' : undefined}
        {...restantes}
      />
      {aide ? (
        <span className="champ-aide" id={`${id}-aide`}>
          {aide}
        </span>
      ) : null}
      {erreur ? (
        <span className="champ-erreur" id={`${id}-erreur`} role="alert">
          {erreur}
        </span>
      ) : null}
    </div>
  )
}

interface Option {
  valeur: string
  libelle: string
}

interface ProprietesSelection
  extends ProprietesCommunes,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name' | 'id' | 'children'> {
  options: Option[]
  placeholder?: string
}

export function ChampSelection({
  nom,
  etiquette,
  erreur,
  aide,
  obligatoire,
  options,
  placeholder,
  ...restantes
}: ProprietesSelection): React.JSX.Element {
  const id = genererId(nom)
  const idsDescription: string[] = []
  if (aide) idsDescription.push(`${id}-aide`)
  if (erreur) idsDescription.push(`${id}-erreur`)

  return (
    <div className="champ">
      <label htmlFor={id} className={`champ-etiquette${obligatoire ? ' champ-obligatoire' : ''}`}>
        {etiquette}
      </label>
      <select
        id={id}
        name={nom}
        className="champ-controle"
        autoComplete="off"
        aria-invalid={erreur ? 'true' : undefined}
        aria-describedby={idsDescription.length > 0 ? idsDescription.join(' ') : undefined}
        aria-required={obligatoire ? 'true' : undefined}
        {...restantes}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.valeur} value={option.valeur}>
            {option.libelle}
          </option>
        ))}
      </select>
      {aide ? (
        <span className="champ-aide" id={`${id}-aide`}>
          {aide}
        </span>
      ) : null}
      {erreur ? (
        <span className="champ-erreur" id={`${id}-erreur`} role="alert">
          {erreur}
        </span>
      ) : null}
    </div>
  )
}

/** Groupe de champs sur une grille responsive. */
export function GrilleChamps({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="champ-grille">{children}</div>
}
