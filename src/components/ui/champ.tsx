import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

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
