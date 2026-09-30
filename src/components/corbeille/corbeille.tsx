'use client'

import { useState } from 'react'

import { t, tf } from '@content/index'

import { Bouton } from '@/components/ui/bouton'
import { ModaleConfirmation } from '@/components/ui/modale'
import { useNotifications } from '@/components/ui/notifications'
import { Pagination } from '@/components/patients/liste-patients'
import { requeteApi, messageErreur } from '@/lib/api-client'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  CORBEILLE (§23)
 * =============================================================================
 *
 *  Deux listes distinctes, volontairement separees :
 *
 *   1. Les elements RESTAURABLES — la fenetre de 24 heures n'est pas ecoulee.
 *      Chacun porte un bouton « Restaurer ».
 *
 *   2. Les elements EXPIRES — la fenetre est ecoulee, ils ne sont plus
 *      restaurables (la suppression definitive est reservee au script
 *      d'entretien serveur, voir `npm run corbeille:purger`).
 *
 *  AUTORITE DU SERVEUR
 *
 *  Le temps restant vient du SERVEUR (`tempsRestantMs`). Le navigateur ne le
 *  recalcule jamais : il n'affiche que ce que le serveur a decide. C'est ce qui
 *  garantit qu'un poste dont l'horloge est fausse ne peut pas restaurer un
 *  element en realite expire — la restauration est de toute facon revalidee
 *  cote serveur, qui reste seul juge.
 *
 *  Aucune suppression definitive n'est proposee dans cette interface : detruire
 *  une donnee medicale doit rester une operation d'exploitation explicite, pas
 *  un clic dans une barre d'outils.
 */

interface ElementCorbeille {
  id: string
  type: string
  description: string
  supprimePar: string | null
  supprimeLe: string
  expireLe: string
  /** Fourni uniquement pour les elements encore restaurables. */
  tempsRestantMs?: number
}

interface ReponseCorbeille {
  fenetreHeures: number
  elements: ElementCorbeille[]
  total: number
  page: number
  taille: number
  pages: number
  expires: ElementCorbeille[]
  expiresTotal: number
}

const TAILLE_PAGE = 25

/** Formate une duree en millisecondes sous forme lisible en francais. */
function formaterDuree(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 min'

  const totalMinutes = Math.floor(ms / 60000)
  const heures = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (heures > 0) {
    return minutes > 0 ? `${heures} h ${minutes} min` : `${heures} h`
  }
  return `${Math.max(minutes, 1)} min`
}

/** Formate une date et une heure en francais. */
function formaterDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Libelle francais du type d'entite, avec repli sur la valeur brute. */
function libelleType(type: string): string {
  const libelle = t(`corbeille.types.${type}`)
  return libelle === `corbeille.types.${type}` ? type : libelle
}

export function Corbeille(): React.JSX.Element {
  const notifications = useNotifications()
  const [page, setPage] = useState(1)
  const [aRestaurer, setARestaurer] = useState<ElementCorbeille | null>(null)
  const [enCours, setEnCours] = useState(false)

  const { donnees, chargement, erreur, recharger } = useRequete<ReponseCorbeille>(
    `/api/trash?page=${page}&taille=${TAILLE_PAGE}`,
  )

  async function confirmerRestauration(): Promise<void> {
    if (!aRestaurer) return
    setEnCours(true)
    try {
      await requeteApi(`/api/trash/${aRestaurer.id}/restore`, { methode: 'POST' })
      notifications.succes(t('corbeille.restaurationReussie'))
      setARestaurer(null)
      recharger()
    } catch (cause) {
      notifications.erreur(messageErreur(cause))
    } finally {
      setEnCours(false)
    }
  }

  const restaurables = donnees?.elements ?? []
  const expires = donnees?.expires ?? []
  const vide = donnees !== null && restaurables.length === 0 && expires.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <p className="champ-aide">{t('corbeille.aide')}</p>

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

      {vide ? (
        <div className="etat-vide">
          <p className="etat-vide-titre">{t('corbeille.aucun')}</p>
        </div>
      ) : null}

      {/* ── Elements restaurables ─────────────────────────────────────────── */}
      {restaurables.length > 0 ? (
        <>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('corbeille.type')}</th>
                  <th scope="col">{t('corbeille.description')}</th>
                  <th scope="col">{t('corbeille.supprimePar')}</th>
                  <th scope="col">{t('corbeille.dateSuppression')}</th>
                  <th scope="col">{t('corbeille.tempsRestant')}</th>
                  <th scope="col">{t('commun.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {restaurables.map((element) => (
                  <tr key={element.id}>
                    <td data-etiquette={t('corbeille.type')}>{libelleType(element.type)}</td>
                    <td data-etiquette={t('corbeille.description')}>{element.description}</td>
                    <td data-etiquette={t('corbeille.supprimePar')}>
                      {element.supprimePar ?? '—'}
                    </td>
                    <td data-etiquette={t('corbeille.dateSuppression')}>
                      {formaterDate(element.supprimeLe)}
                    </td>
                    <td data-etiquette={t('corbeille.tempsRestant')}>
                      {formaterDuree(element.tempsRestantMs ?? 0)}
                    </td>
                    <td data-etiquette={t('commun.actions')}>
                      <Bouton
                        variante="secondaire"
                        taille="petite"
                        onClick={() => setARestaurer(element)}
                      >
                        {t('corbeille.restaurer')}
                      </Bouton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={donnees?.page ?? 1}
            pages={donnees?.pages ?? 1}
            total={donnees?.total ?? 0}
            onChangerPage={setPage}
          />
        </>
      ) : null}

      {/* ── Elements expires (lecture seule) ──────────────────────────────── */}
      {expires.length > 0 ? (
        <>
          <h2 className="carte-titre" style={{ marginTop: 'var(--espace-5)' }}>
            {t('corbeille.expire')}
          </h2>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('corbeille.type')}</th>
                  <th scope="col">{t('corbeille.description')}</th>
                  <th scope="col">{t('corbeille.supprimePar')}</th>
                  <th scope="col">{t('corbeille.dateSuppression')}</th>
                </tr>
              </thead>
              <tbody>
                {expires.map((element) => (
                  <tr key={element.id}>
                    <td data-etiquette={t('corbeille.type')}>{libelleType(element.type)}</td>
                    <td data-etiquette={t('corbeille.description')}>{element.description}</td>
                    <td data-etiquette={t('corbeille.supprimePar')}>
                      {element.supprimePar ?? '—'}
                    </td>
                    <td data-etiquette={t('corbeille.dateSuppression')}>
                      {formaterDate(element.supprimeLe)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <ModaleConfirmation
        ouverte={aRestaurer !== null}
        titre={t('corbeille.restaurer')}
        message={
          aRestaurer
            ? tf('corbeille.ilRestait', { temps: formaterDuree(aRestaurer.tempsRestantMs ?? 0) })
            : ''
        }
        avertissement={aRestaurer?.description}
        libelleConfirmer={t('corbeille.restaurer')}
        enCours={enCours}
        onConfirmer={confirmerRestauration}
        onAnnuler={() => {
          if (!enCours) setARestaurer(null)
        }}
      />
    </div>
  )
}
