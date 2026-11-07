'use client'

import { useState } from 'react'

import type { FiltresPeriode, Periode } from '@/components/finances/contrats-finances'

/**
 * =============================================================================
 *  FILTRES DE PÉRIODE DU SITE FINANCIER
 * =============================================================================
 *
 *  Six fenêtres, dont « Personnalisé » qui ouvre deux champs de date.
 *
 *  Le sélecteur n'apparaît QUE dans une catégorie ouverte (revenus, dette,
 *  dépenses) : la page d'accueil ne montre que les trois boîtes, sans période
 *  imposée.
 *
 *  « Cette année » ouvre un SÉLECTEUR D'ANNÉE : sans lui, « cette année » ne
 *  désignait jamais qu'une seule année, celle du poste.
 *
 *  Les années proposées vont de l'exercice courant jusqu'à 2025, la plus
 *  récente en tête, et s'étendent d'elles-mêmes à chaque nouvelle année
 *  civile. Aucune année future : un exercice à venir serait vide par
 *  construction.
 */

const PRESETS: ReadonlyArray<{ valeur: Periode; libelle: string }> = [
  { valeur: '7-jours', libelle: '7 derniers jours' },
  { valeur: '30-jours', libelle: '30 derniers jours' },
  { valeur: 'mois', libelle: 'Ce mois' },
  { valeur: 'annee', libelle: 'Cette année' },
  { valeur: 'annee-precedente', libelle: 'Année précédente' },
  { valeur: 'personnalisee', libelle: 'Personnalisé' },
]

export function FiltresPeriodeUI({
  filtres,
  onChanger,
}: {
  filtres: FiltresPeriode
  onChanger: (suivants: FiltresPeriode) => void
}): React.JSX.Element {
  const [du, setDu] = useState(filtres.du)
  const [au, setAu] = useState(filtres.au)

  const annees = anneesDisponibles()
  const plageValide = Boolean(du && au && au >= du)

  return (
    <div className="finances-filtres" role="group" aria-label="Période">
      <div className="finances-groupe-periode">
        {PRESETS.map((option) => (
          <button
            key={option.valeur}
            type="button"
            aria-pressed={filtres.periode === option.valeur}
            onClick={() => onChanger({ ...filtres, periode: option.valeur })}
          >
            {option.libelle}
          </button>
        ))}
      </div>

      {filtres.periode === 'annee' ? (
        <label className="finances-selecteur-annee">
          <span>Exercice</span>
          <select
            value={filtres.annee}
            onChange={(e) => onChanger({ ...filtres, annee: Number(e.target.value) })}
          >
            {annees.map((annee) => (
              <option key={annee} value={annee}>
                {annee}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {filtres.periode === 'personnalisee' ? (
        <form
          className="finances-filtres-dates"
          onSubmit={(evenement) => {
            evenement.preventDefault()
            if (plageValide) onChanger({ ...filtres, du, au })
          }}
        >
          <label>
            <span>Du</span>
            <input type="date" value={du} onChange={(e) => setDu(e.target.value)} required />
          </label>
          <label>
            <span>Au</span>
            <input type="date" value={au} onChange={(e) => setAu(e.target.value)} required />
          </label>
          <button
            type="submit"
            className="finances-bouton finances-bouton-principal"
            disabled={!plageValide}
          >
            Appliquer
          </button>
        </form>
      ) : null}
    </div>
  )
}

/**
 * Années proposées par le sélecteur d'exercice : de l'année courante jusqu'à
 * 2025, la plus récente en tête.
 *
 * La borne haute est LUE À L'EXÉCUTION (`new Date().getFullYear()`) : au 1er
 * janvier 2027, 2027 apparaît de lui-même, sans modification ni redéploiement.
 * Aucune année future n'est proposée — un exercice à venir serait vide par
 * construction.
 */
const PREMIERE_ANNEE = 2025

function anneesDisponibles(): number[] {
  const courante = new Date().getFullYear()
  const premiere = Math.min(PREMIERE_ANNEE, courante)
  return Array.from({ length: courante - premiere + 1 }, (_, index) => courante - index)
}
