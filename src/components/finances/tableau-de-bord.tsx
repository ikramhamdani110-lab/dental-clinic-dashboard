'use client'

/**
 * =============================================================================
 *  SITE FINANCIER PRIVÉ — TROIS BOÎTES, PUIS UNE LISTE
 * =============================================================================
 *
 *  L'écran tient en deux états, et rien d'autre :
 *
 *    1. ACCUEIL — trois boîtes de même poids, sans période imposée :
 *         + REVENUS     argent réellement reçu, venu du secrétariat
 *           DETTE       soldes patients, jamais comptés comme revenus
 *         − DÉPENSES    saisies par le médecin
 *
 *    2. CATÉGORIE OUVERTE — la liste de la boîte cliquée, son total sur la
 *       période choisie, et le sélecteur de période. Le retour aux trois boîtes
 *       se fait par un simple bouton : aucune barre de navigation.
 *
 *  RÈGLES DE CALCUL (jamais contournées)
 *    - Revenus  = paiements réels du secrétariat. Le médecin n'en saisit aucun.
 *    - Dette    = soldes restants des patients. Ce n'est pas de l'argent reçu.
 *    - Dépenses = saisies par le médecin, sur la période.
 *
 *  Aucun total n'est recalculé ici : tout vient de `/api/finances/*`, qui agrège
 *  en base. L'écran ne fait qu'afficher.
 */

import { useMemo, useState } from 'react'

import { formaterMontant } from '@backend/domain/finance'

import { BoutonNouvelleDepense } from '@/components/finances/bouton-nouvelle-depense'
import {
  FILTRES_DEFAUT,
  decrirePeriode,
  parametresPeriode,
  type FiltresPeriode,
  type LigneDepense,
  type Synthese,
} from '@/components/finances/contrats-finances'
import { DeconnexionFinances } from '@/components/finances/deconnexion-finances'
import { FiltresPeriodeUI } from '@/components/finances/filtres-periode'
import { FormulaireDepense, type ModeDepense } from '@/components/finances/formulaire-depense'
import {
  HistoriqueFinancier,
  type IntentionDepense,
  type OngletHistorique,
} from '@/components/finances/historique-financier'
import { useRequeteFinanciere } from '@/lib/hooks/use-requete-financiere'

type Boite = 'revenus' | 'dette' | 'depenses'

/** Une boîte ouverte affiche la liste correspondante. */
const ONGLET_DE_BOITE: Record<Boite, OngletHistorique> = {
  revenus: 'revenus',
  dette: 'dettes',
  depenses: 'depenses',
}

const LIBELLE_DE_BOITE: Record<Boite, string> = {
  revenus: 'Revenus',
  dette: 'Dette',
  depenses: 'Dépenses',
}

interface EtatFormulaire {
  mode: ModeDepense
  depense: LigneDepense | null
  /** En modification : 'supprimer' ouvre directement la confirmation. */
  intention: IntentionDepense
}

export function TableauBordFinancier(): React.JSX.Element {
  const [filtres, setFiltres] = useState<FiltresPeriode>(FILTRES_DEFAUT)
  const [version, setVersion] = useState(0)
  const [boiteOuverte, setBoiteOuverte] = useState<Boite | null>(null)
  const [formulaire, setFormulaire] = useState<EtatFormulaire | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const params = useMemo(() => parametresPeriode(filtres), [filtres])

  const synthese = useRequeteFinanciere<Synthese>(`/api/finances/summary?${params}&v=${version}`)

  const donnees = synthese.donnees
  const chargement = synthese.chargement && !donnees

  /** Une écriture a réussi : totaux et liste se rechargent. */
  function apresEcriture(texte: string): void {
    setFormulaire(null)
    setMessage(texte)
    setVersion((v) => v + 1)
    synthese.recharger()
    window.setTimeout(() => setMessage(null), 4000)
  }

  function ouvrirCreation(): void {
    setFormulaire({ mode: 'creation', depense: null, intention: 'modifier' })
  }

  /** Total de la catégorie ouverte, sur la période choisie. */
  function totalDeLaBoite(boite: Boite): number {
    if (!donnees) return 0
    if (boite === 'revenus') return donnees.revenusCentimes
    if (boite === 'dette') return donnees.restantDuCentimes
    return donnees.depensesCentimes
  }

  return (
    <div className="finances-page">
      <div className="finances-barre">
        {boiteOuverte ? (
          <button
            type="button"
            className="finances-retour"
            onClick={() => setBoiteOuverte(null)}
          >
            <span aria-hidden="true">←</span>
            Retour
          </button>
        ) : (
          <span />
        )}
        <DeconnexionFinances />
      </div>

      {synthese.erreur && !donnees ? (
        <section className="finances-erreur" role="alert">
          <div>
            <p className="finances-erreur-titre">Impossible de charger les finances</p>
            <p className="finances-erreur-detail">{synthese.erreur}</p>
          </div>
          <button type="button" className="finances-bouton" onClick={synthese.recharger}>
            Réessayer
          </button>
        </section>
      ) : null}

      {message ? (
        <p className="finances-toast" role="status">
          {message}
        </p>
      ) : null}

      {/*
        SÉLECTEUR DE PÉRIODE GLOBAL — hors des boîtes, au-dessus d'elles.
        Il pilote les TROIS totaux et la liste de la catégorie ouverte : une
        seule période pour tout l'écran, jamais une période par carte.
      */}
      <FiltresPeriodeUI filtres={filtres} onChanger={setFiltres} />

      {boiteOuverte === null ? (
        <section className="finances-boites" aria-label="Situation financière">
          <BoiteFinanciere
            nature="revenus"
            signe="+"
            libelle="Revenus"
            montant={donnees?.revenusCentimes ?? 0}
            chargement={chargement}
            detail={
              donnees
                ? `${donnees.nombrePaiements} encaissement${donnees.nombrePaiements > 1 ? 's' : ''}`
                : 'Chargement…'
            }
            onOuvrir={() => setBoiteOuverte('revenus')}
          />

          <BoiteFinanciere
            nature="dette"
            signe=""
            libelle="Dette"
            montant={donnees?.restantDuCentimes ?? 0}
            chargement={chargement}
            detail={
              donnees
                ? `${donnees.nombrePatientsDebiteurs} patient${
                    donnees.nombrePatientsDebiteurs > 1 ? 's' : ''
                  } débiteur${donnees.nombrePatientsDebiteurs > 1 ? 's' : ''}`
                : 'Chargement…'
            }
            onOuvrir={() => setBoiteOuverte('dette')}
          />

          <BoiteFinanciere
            nature="depenses"
            signe="−"
            libelle="Dépenses"
            montant={donnees?.depensesCentimes ?? 0}
            chargement={chargement}
            detail={
              donnees
                ? `${donnees.nombreDepenses} dépense${donnees.nombreDepenses > 1 ? 's' : ''}`
                : 'Chargement…'
            }
            onOuvrir={() => setBoiteOuverte('depenses')}
          />
        </section>
      ) : (
        <section
          className={`finances-categorie finances-categorie--${boiteOuverte}`}
          aria-label={`${LIBELLE_DE_BOITE[boiteOuverte]} — détail`}
        >
          <header className="finances-categorie-entete">
            <h1 className="finances-categorie-libelle">
              {boiteOuverte === 'depenses' ? '− ' : boiteOuverte === 'revenus' ? '+ ' : ''}
              {LIBELLE_DE_BOITE[boiteOuverte]}
            </h1>

            <div className="finances-categorie-total">
              <span className="finances-categorie-total-libelle">{decrirePeriode(filtres)}</span>
              <span className="finances-categorie-total-valeur">
                {chargement ? (
                  <span className="finances-squelette-inline" />
                ) : (
                  formaterMontant(totalDeLaBoite(boiteOuverte))
                )}
              </span>
            </div>

            {boiteOuverte === 'depenses' ? (
              <BoutonNouvelleDepense onClick={ouvrirCreation} />
            ) : null}
          </header>

          <HistoriqueFinancier
            onglet={ONGLET_DE_BOITE[boiteOuverte]}
            periode={params}
            version={version}
            onOuvrirDepense={(depense, intention) =>
              setFormulaire({ mode: 'modification', depense, intention })
            }
          />
        </section>
      )}

      {formulaire ? (
        <FormulaireDepense
          mode={formulaire.mode}
          depense={formulaire.depense}
          demandeSuppression={formulaire.intention === 'supprimer'}
          onFermer={() => setFormulaire(null)}
          onEnregistre={apresEcriture}
        />
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
//  BOÎTE FINANCIÈRE — L'ÉLÉMENT VISUEL CENTRAL
// -----------------------------------------------------------------------------

function BoiteFinanciere({
  nature,
  signe,
  libelle,
  montant,
  detail,
  chargement,
  onOuvrir,
}: {
  nature: Boite
  signe: string
  libelle: string
  montant: number
  detail: string
  chargement: boolean
  onOuvrir: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`finances-boite finances-boite--${nature}`}
      onClick={onOuvrir}
      aria-label={`${libelle} — voir le détail`}
    >
      <span className="finances-boite-tete">
        {/*
          Le signe est PUREMENT VISUEL (`aria-hidden`) : le sens est porté par
          le mot. Un lecteur d'écran annonce « Revenus » ou « Dépenses », sans
          qu'on lui lise « moins » deux fois.
        */}
        <span className="finances-boite-libelle">
          {signe ? (
            <span className="finances-boite-signe" aria-hidden="true">
              {signe}
            </span>
          ) : null}
          {libelle}
        </span>
      </span>

      <span className={`finances-boite-montant${chargement ? ' finances-boite-montant--chargement' : ''}`}>
        {chargement ? (
          <span className="finances-squelette-inline finances-squelette-inline--large" />
        ) : (
          formaterMontant(montant)
        )}
      </span>

      <span className="finances-boite-detail">{detail}</span>
    </button>
  )
}

