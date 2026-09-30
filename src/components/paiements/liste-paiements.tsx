'use client'

import { useState } from 'react'

import { t } from '@content/index'
import { formaterMontant } from '@backend/domain/finance'

import { BadgeStatutPaiement } from '@/components/ui/badge-statut'
import { ChampTexte } from '@/components/ui/champ'
import { Pagination } from '@/components/patients/liste-patients'
import { useDebounce, useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  LISTE DES PAIEMENTS (§16, §26)
 * =============================================================================
 *
 *  Les paiements ANNULE restent visibles avec leur statut : l'historique
 *  financier n'est jamais efface (§17).
 *
 *  La METHODE de paiement n'est plus affichee ni filtrable : le medecin raisonne
 *  en montants et en dates, pas en canaux d'encaissement.
 *
 *  Pagination serveur (§35).
 */

interface Paiement {
  id: string
  montantCentimes: number
  datePaiement: string
  statut: string
  patient: { nom: string; prenom: string }
  treatment: { typeTraitement: string }
}

interface ReponsePaiements {
  elements: Paiement[]
  total: number
  page: number
  taille: number
  pages: number
}

const TAILLE_PAGE = 25

export function ListePaiements(): React.JSX.Element {
  const [recherche, setRecherche] = useState('')
  const [page, setPage] = useState(1)
  const rechercheDifferee = useDebounce(recherche, 300)

  const parametres = new URLSearchParams({ page: String(page), taille: String(TAILLE_PAGE) })
  if (rechercheDifferee) parametres.set('recherche', rechercheDifferee)

  const { donnees, chargement, erreur, recharger } = useRequete<ReponsePaiements>(
    `/api/payments?${parametres.toString()}`,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="barre-outils">
        <div className="barre-outils-groupe" style={{ flex: 1 }}>
          <div style={{ minWidth: '16rem', flex: 1 }}>
            <ChampTexte
              nom="recherche-paiement"
              etiquette={t('patients.rechercher')}
              placeholder={t('patients.placeholderRecherche')}
              value={recherche}
              onChange={(evenement) => {
                setRecherche(evenement.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
      </div>

      {chargement && !donnees ? (
        <div className="etat-vide">
          <span className="rotation" aria-hidden="true" />
          <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
        </div>
      ) : null}

      {erreur ? (
        <div className="encadre-erreur" role="alert">
          <p>{erreur}</p>
          <button type="button" className="bouton-lien" onClick={recharger}>
            {t('erreurs.reessayer')}
          </button>
        </div>
      ) : null}

      {donnees && donnees.elements.length === 0 ? (
        <div className="etat-vide">
          <p className="etat-vide-titre">{t('paiements.aucunResultat')}</p>
        </div>
      ) : null}

      {donnees && donnees.elements.length > 0 ? (
        <>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('paiements.datePaiement')}</th>
                  <th scope="col">{t('commun.patient')}</th>
                  <th scope="col">{t('paiements.traitementAssocie')}</th>
                  <th scope="col" className="tableau-numerique">
                    {t('paiements.montant')}
                  </th>
                  <th scope="col">{t('commun.statut')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.elements.map((paiement) => (
                  <tr key={paiement.id}>
                    <td data-etiquette={t('paiements.datePaiement')}>
                      {new Date(paiement.datePaiement).toLocaleDateString('fr-FR')}
                    </td>
                    <td data-etiquette={t('commun.patient')}>
                      {paiement.patient.prenom} {paiement.patient.nom}
                    </td>
                    <td data-etiquette={t('paiements.traitementAssocie')}>
                      {paiement.treatment.typeTraitement}
                    </td>
                    <td data-etiquette={t('paiements.montant')} className="tableau-numerique">
                      {formaterMontant(paiement.montantCentimes)}
                    </td>
                    <td data-etiquette={t('commun.statut')}>
                      <BadgeStatutPaiement statut={paiement.statut} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={donnees.page}
            pages={donnees.pages}
            total={donnees.total}
            onChangerPage={setPage}
          />
        </>
      ) : null}
    </div>
  )
}
