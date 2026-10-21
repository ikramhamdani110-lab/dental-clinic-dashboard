'use client'

import { useState } from 'react'

import { t } from '@content/index'

import { ChampSelection } from '@/components/ui/champ'
import { Pagination } from '@/components/patients/liste-patients'
import { useRequete } from '@/lib/hooks/use-requete'
import { localeDates } from '@/lib/locale-dates'
import { useContenu } from '@/components/langue/fournisseur-langue'

/**
 * =============================================================================
 *  JOURNAL D'ACTIVITE (§24)
 * =============================================================================
 *
 *  Consultation paginee des evenements : connexions, creations, modifications,
 *  suppressions, restaurations, corrections de paiement, suppressions
 *  definitives.
 *
 *  Les donnees affichees ne contiennent que des informations d'ACTION : jamais
 *  de mot de passe, d'empreinte ni de secret (§24). Les metadonnees sont
 *  volontairement sobres.
 */

interface EntreeJournal {
  id: string
  action: string
  userEmail: string | null
  entityType: string | null
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

interface ReponseJournal {
  entrees: EntreeJournal[]
  total: number
  page: number
  taille: number
  pages: number
  actionsDisponibles: string[]
}

const TAILLE_PAGE = 30

export function JournalActivite(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const contenu = useContenu()

  const parametres = new URLSearchParams({ page: String(page), taille: String(TAILLE_PAGE) })
  if (action) parametres.set('action', action)

  const { donnees, chargement, erreur, recharger } = useRequete<ReponseJournal>(
    `/api/activity-log?${parametres.toString()}`,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="barre-outils">
        <div style={{ minWidth: '18rem' }}>
          <ChampSelection
            nom="action"
            etiquette={t('journalActivite.filtrerParAction')}
            value={action}
            placeholder={t('journalActivite.toutesLesActions')}
            onChange={(evenement) => {
              setAction(evenement.target.value)
              setPage(1)
            }}
            options={(donnees?.actionsDisponibles ?? []).map((valeur) => ({
              valeur,
              /* La valeur stockee reste la cle de filtre ; le LIBELLE affiche est
                 traduit dans la langue active (repli : la valeur brute). */
              libelle:
                (contenu.journalActivite.libellesActions as Record<string, string> | undefined)?.[
                  valeur
                ] ?? valeur,
            }))}
          />
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

      {donnees && donnees.entrees.length === 0 ? (
        <div className="etat-vide">
          <p className="etat-vide-titre">{t('journalActivite.aucune')}</p>
        </div>
      ) : null}

      {donnees && donnees.entrees.length > 0 ? (
        <>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('journalActivite.horodatage')}</th>
                  <th scope="col">{t('journalActivite.action')}</th>
                  <th scope="col">{t('journalActivite.utilisateur')}</th>
                  <th scope="col">{t('journalActivite.entite')}</th>
                  <th scope="col">{t('journalActivite.details')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.entrees.map((entree) => (
                  <tr key={entree.id}>
                    <td data-etiquette={t('journalActivite.horodatage')}>
                      {new Date(entree.createdAt).toLocaleString(localeDates())}
                    </td>
                    <td data-etiquette={t('journalActivite.action')}>
                      {/* La valeur stockée (français) reste la donnée ; seul le
                          libellé AFFICHÉ suit la langue active. */}
                      {(contenu.journalActivite.libellesActions as Record<string, string> | undefined)?.[
                        entree.action
                      ] ?? entree.action}
                    </td>
                    <td data-etiquette={t('journalActivite.utilisateur')}>
                      {entree.userEmail ?? '—'}
                    </td>
                    <td data-etiquette={t('journalActivite.entite')}>{entree.entityType ?? '—'}</td>
                    <td data-etiquette={t('journalActivite.details')}>
                      {entree.metadata ? (
                        <span className="journal-metadonnees">
                          {JSON.stringify(entree.metadata)}
                        </span>
                      ) : (
                        '—'
                      )}
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
