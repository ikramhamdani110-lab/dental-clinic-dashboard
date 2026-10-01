'use client'

import { useCallback, useEffect, useState } from 'react'

import { t } from '@content/index'

import { BadgeStatutRendezVous } from '@/components/ui/badge-statut'
import { ChampSelection } from '@/components/ui/champ'
import { useNotifications } from '@/components/ui/notifications'
import { signalerModification } from '@/lib/evenements-donnees'
import { Bouton, LienBouton } from '@/components/ui/bouton'
import { ApiError, messageErreur, requeteApi } from '@/lib/api-client'

/** Valeur sentinelle représentant « pas de filtre de statut » (afficher tous). */
const STATUT_TOUS = '' as const

/**
 * =============================================================================
 *  PLANNING DES RENDEZ-VOUS — VUES JOUR / SEMAINE / MOIS (§14)
 * =============================================================================
 *
 *  Trois vues, conformes a la specification. Les rendez-vous sont lus par
 *  periode (`du` / `au`) : le serveur ne renvoie que la fenetre affichee, jamais
 *  toute la table (§35).
 *
 *  La reprogrammation passe par une route dediee (POST .../reschedule) qui
 *  CONSERVE l'ancien creneau dans l'historique (§15).
 */

interface RendezVous {
  id: string
  /** Identifiant du patient — issu de la BDD, utilisé pour le lien « Fichier patient ». */
  patientId: string
  patient: { nom: string; prenom: string; telephone: string }
  dateDebut: string
  dateFin: string
  motif: string | null
  typeTraitement: string | null
  statut: string
}

type Vue = 'jour' | 'semaine' | 'mois'

/**
 * Statuts proposes dans le selecteur de la colonne « Statut » de chaque ligne.
 *
 * Le vocabulaire est celui du tableau de bord et de la fiche patient, afin qu'un
 * meme etat ne soit jamais designe de deux facons. Les quatre statuts visibles
 * sont exactement :
 *
 *   Planifie ..... le rendez-vous est pris, rien de plus ;
 *   Fait ......... le patient est venu, la consultation a eu lieu ;
 *   Absent ....... le patient ne s'est pas presente ;
 *   Reprogramme .. le rendez-vous a ete reporte.
 *
 * « Planifie » reste selectionne par defaut tant que le medecin ne change rien :
 * c'est la seule evolution automatique du systeme, et elle ne se produit qu'A LA
 * CREATION du rendez-vous (cf. service). Aucun passage automatique a « Fait » :
 * un rendez-vous reste « Planifie » meme apres le passage de sa date, tant que
 * le medecin ne l'a pas change lui-meme. « Fait » ne veut donc dire que « le
 * medecin a confirme que la consultation a eu lieu ».
 *
 * `TERMINE` est la valeur stockee qui porte ce libelle. Les autres valeurs de
 * l'enumeration de la base (`CONFIRME`, `EN_ATTENTE`, `EN_COURS`, `ANNULE`) sont
 * conservees en base et dans l'historique : elles restent lisibles mais ne sont
 * plus selectables, et « Confirme » ne fait plus partie du vocabulaire
 * visible (§2). Aucun changement de schema, d'enumeration ni de migration.
 *
 * AUCUN CHANGEMENT AUTOMATIQUE : ni le tableau de bord, ni une tache de fond ne
 * comparent la date du rendez-vous a l'instant present pour reecrire son
 * statut. Le seul chemin vers « Fait », « Reprogramme » ou « Absent » est ce
 * selecteur.
 */
const OPTIONS_STATUT = [
  { valeur: 'PLANIFIE', libelle: t('rendezVous.statuts.PLANIFIE') },
  { valeur: 'TERMINE', libelle: t('rendezVous.statuts.TERMINE') },
  { valeur: 'ABSENT', libelle: t('rendezVous.statuts.ABSENT') },
  { valeur: 'REPROGRAMME', libelle: t('rendezVous.statuts.REPROGRAMME') },
]

/**
 * Options pour le FILTRE de statut dans la barre d'outils du planning.
 *
 * La valeur vide (STATUT_TOUS) déclenche une requête sans paramètre `statut` :
 * le serveur renvoie tous les rendez-vous de la période (comportement par défaut).
 * Un statut explicite est transmis comme paramètre `statut` à l'API et filtré
 * directement en base (§14, §26).
 *
 * Filtre ET date travaillent ensemble : « Reprogrammé + aujourd'hui » affiche
 * uniquement les rendez-vous reprogrammés du jour sélectionné.
 */
const OPTIONS_FILTRE_STATUT = [
  { valeur: STATUT_TOUS, libelle: 'Tous' },
  { valeur: 'PLANIFIE', libelle: t('rendezVous.statuts.PLANIFIE') },
  { valeur: 'TERMINE', libelle: t('rendezVous.statuts.TERMINE') },
  { valeur: 'ABSENT', libelle: t('rendezVous.statuts.ABSENT') },
  { valeur: 'REPROGRAMME', libelle: t('rendezVous.statuts.REPROGRAMME') },
]

export function PlanningRendezVous(): React.JSX.Element {
  const [vue, setVue] = useState<Vue>('jour')
  const [reference, setReference] = useState(() => new Date())
  const [rendezVous, setRendezVous] = useState<RendezVous[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const notifications = useNotifications()
  /** Identifiant du rendez-vous en cours de mise a jour, pour desactiver sa ligne. */
  const [enCoursId, setEnCoursId] = useState<string | null>(null)

  /**
   * Rendez-vous en attente de CONFIRMATION DE SUPPRESSION.
   *
   * `null` = aucun dialogue ouvert. Renseigne, la ligne correspondante affiche un
   * petit etat de confirmation en ligne (« Supprimer ce rendez-vous ? » /
   * « Annuler » / « Supprimer ») : le premier clic NE SUPPRIME RIEN, il ouvre
   * seulement la question. Rien n'est envoye au serveur avant le second clic.
   */
  const [aSupprimer, setASupprimer] = useState<string | null>(null)
  /** Suppression effectivement en cours : desactive les deux boutons. */
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)

  /**
   * Filtre de statut du planning.
   * STATUT_TOUS (chaîne vide) = aucun filtre → le serveur renvoie tout.
   * Un statut explicite est transmis comme paramètre `statut` à l'API, qui
   * l'applique directement en base (§14, §26). Changer ce filtre redéclenche
   * immédiatement la requête via la dépendance dans `charger`.
   */
  const [filtreStatut, setFiltreStatut] = useState<string>(STATUT_TOUS)

  /**
   * Bornes de la periode affichee.
   *
   * Les bornes de periode sont calculees, puis reduites a des CHAINES ISO.
   *
   * POURQUOI DES CHAINES ET NON LES OBJETS `Date` :
   *   `bornesPeriode` fabrique de NOUVEAUX objets `Date` a chaque rendu. Utilises
   *   directement comme dependances, leur identite change a chaque fois, ce qui
   *   recreait `charger`, relancait le `useEffect`, declenchait `setChargement`
   *   donc un nouveau rendu... : une BOUCLE DE REQUETES infinie (le serveur etait
   *   inonde de `/api/appointments` et la page ne finissait jamais de charger).
   *   Une chaine ISO est une valeur PRIMITIVE : sa comparaison est par contenu,
   *   donc stable tant que la periode affichee ne change pas.
   */
  const { debut, fin } = bornesPeriode(vue, reference)
  const debutIso = debut.toISOString()
  const finIso = fin.toISOString()

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      // Le filtre de statut est ajouté uniquement quand il est sélectionné.
      // STATUT_TOUS (chaîne vide) → aucun paramètre → le serveur ne filtre pas.
      const statutParam = filtreStatut ? `&statut=${filtreStatut}` : ''
      const reponse = await requeteApi<{ elements: RendezVous[] }>(
        `/api/appointments?du=${debutIso}&au=${finIso}&taille=100${statutParam}`,
      )
      setRendezVous(reponse.elements)
    } catch (cause) {
      setErreur(messageErreur(cause))
    } finally {
      setChargement(false)
    }
  }, [debutIso, finIso, filtreStatut])

  useEffect(() => {
    void charger()
  }, [charger])

  function naviguer(direction: -1 | 1): void {
    setReference((precedente) => {
      const suivante = new Date(precedente)
      if (vue === 'jour') suivante.setDate(suivante.getDate() + direction)
      else if (vue === 'semaine') suivante.setDate(suivante.getDate() + direction * 7)
      else suivante.setMonth(suivante.getMonth() + direction)
      return suivante
    })
  }

  /**
   * Change le statut d'un rendez-vous.
   * L'API (`PUT /api/appointments/:id`) MODIFIE le rendez-vous existant : aucun
   * nouveau rendez-vous n'est cree, donc aucun doublon n'est possible. La ligne
   * est desactivee pendant l'appel pour qu'un double-clic ne declenche pas deux
   * requetes, puis la liste est rechargee afin que le badge et le tableau de bord
   * reflètent l'etat reel.
   */
  const changerStatut = useCallback(
    async (rendezVousId: string, statut: string) => {
      setEnCoursId(rendezVousId)
      try {
        await requeteApi(`/api/appointments/${rendezVousId}`, {
          methode: 'PUT',
          corps: { statut },
        })
        notifications.succes(t('rendezVous.statutMisAJour'))
        await charger()
        // Le tableau de bord compte les patients du jour : il doit suivre.
        signalerModification('rendezVous')
      } catch (cause) {
        notifications.erreur(
          cause instanceof ApiError ? cause.message : t('erreurs.serviceIndisponible'),
        )
        // La valeur affichee doit correspondre a la base : on recharge.
        await charger()
      } finally {
        setEnCoursId(null)
      }
    },
    // `charger` est stable : les bornes sont converties en chaines ISO.
    [charger, notifications],
  )

  /**
   * Supprime un rendez-vous — PAS au premier clic.
   *
   * Le premier clic passe seulement l'identifiant dans `aSupprimer` : la ligne
   * bascule en Confirmation, rien n'est appele. Cette fonction n'est atteinte
   * qu'APRÈS la reponse affirmative du medecin.
   *
   * L'API `DELETE /api/appointments/:id` applique la CORBEILLE existante
   * (suppression logique, 24 h) : le rendez-vous disparait des listes — donc
   * l'API le filtre des lors — sans detruire le patient, le traitement, le
   * paiement ni l'historique financier (§23, §49). La suppression physique
   * n'intervient qu'apres expiration, hors de ce parcours.
   *
   * La session authentifiee du medecin est verifiee COTE SERVEUR par la route
   * privee : masquer le bouton n'est jamais la protection, l'API l'est.
   */
  const supprimerRendezVous = useCallback(
    async (rendezVousId: string) => {
      setSuppressionEnCours(true)
      try {
        await requeteApi(`/api/appointments/${rendezVousId}`, { methode: 'DELETE' })
        // Retrait immediat de la liste, avant le rechargement complet.
        setRendezVous((liste) => liste.filter((rdv) => rdv.id !== rendezVousId))
        setASupprimer(null)
        notifications.succes(t('rendezVous.supprimerReussie'))
        await charger()
        // Le tableau de bord et la fiche patient comptent les rendez-vous.
        signalerModification('rendezVous')
      } catch (cause) {
        // Echec : le rendez-vous RESTE dans la liste, et le motif est dit.
        notifications.erreur(
          cause instanceof ApiError ? cause.message : messageErreur(cause),
        )
        setASupprimer(null)
        await charger()
      } finally {
        setSuppressionEnCours(false)
      }
    },
    [charger, notifications],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
      <div className="barre-outils">
        <div className="barre-outils-groupe">
          <Bouton variante="secondaire" taille="petite" onClick={() => naviguer(-1)}>
            ‹ {t('commun.precedent')}
          </Bouton>
          <Bouton variante="secondaire" taille="petite" onClick={() => setReference(new Date())}>
            {t('commun.aujourdhui')}
          </Bouton>
          <Bouton variante="secondaire" taille="petite" onClick={() => naviguer(1)}>
            {t('commun.suivant')} ›
          </Bouton>
          <span style={{ marginLeft: 'var(--espace-3)', color: 'var(--texte-secondaire)' }}>
            {titrePeriode(vue, reference)}
          </span>
        </div>

        <div className="barre-outils-groupe">
          {/* Filtre de statut — travaille conjointement avec la date sélectionnée.
              Choisir « Reprogrammé » + vue Jour affiche uniquement les rendez-vous
              reprogrammés pour ce jour. « Tous » réinitialise le filtre. */}
          <div style={{ minWidth: '10rem' }}>
            <ChampSelection
              nom="filtre-statut-planning"
              etiquette="Statut"
              value={filtreStatut}
              options={OPTIONS_FILTRE_STATUT}
              onChange={(evenement) => setFiltreStatut(evenement.target.value)}
            />
          </div>

          <div className="onglets" role="tablist" aria-label={t('rendezVous.planning')}>
            {(['jour', 'semaine', 'mois'] as Vue[]).map((valeur) => (
              <button
                key={valeur}
                type="button"
                role="tab"
                aria-selected={vue === valeur}
                className="onglet"
                onClick={() => setVue(valeur)}
              >
                {t(`rendezVous.${valeur}`)}
              </button>
            ))}
          </div>
          <LienBouton href="/rendez-vous/nouveau" variante="principal" taille="petite">
            {t('rendezVous.nouveau')}
          </LienBouton>
        </div>
      </div>

      {chargement ? (
        <div className="etat-vide">
          <span className="rotation" aria-hidden="true" />
          <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
        </div>
      ) : null}

      {erreur ? (
        <div className="encadre-erreur" role="alert">
          <p>{erreur}</p>
          <button type="button" className="bouton-lien" onClick={() => void charger()}>
            {t('erreurs.reessayer')}
          </button>
        </div>
      ) : null}

      {!chargement && !erreur && rendezVous.length === 0 ? (
        <div className="etat-vide">
          <p className="etat-vide-titre">{t('rendezVous.aucun')}</p>
          <LienBouton href="/rendez-vous/nouveau" variante="principal">
            {t('rendezVous.nouveau')}
          </LienBouton>
        </div>
      ) : null}

      {!chargement && rendezVous.length > 0 ? (
        <div className="carte">
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('commun.date')}</th>
                  <th scope="col">{t('commun.patient')}</th>
                  <th scope="col">{t('rendezVous.traitement')}</th>
                  <th scope="col">{t('commun.statut')}</th>
                  <th scope="col">{t('rendezVous.statutAffiche')}</th>
                  <th scope="col">{t('commun.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rendezVous.map((rdv) => (
                  <tr key={rdv.id}>
                    <td data-etiquette={t('commun.date')}>
                      {/*
                        L'HEURE N'EST PLUS AFFICHEE (demande explicite) : seule la
                        DATE reste visible. La valeur stockee du creneau, elle, est
                        inchangee — la planification, la detection de conflit et
                        les filtres de date continuent de l'utiliser.
                      */}
                      {new Date(rdv.dateDebut).toLocaleDateString('fr-FR', {
                        weekday: 'short',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </td>
                    <td data-etiquette={t('commun.patient')}>
                      {rdv.patient.prenom} {rdv.patient.nom}
                    </td>
                    <td data-etiquette={t('rendezVous.traitement')}>
                      {rdv.typeTraitement ?? rdv.motif ?? '—'}
                    </td>
                    <td data-etiquette={t('commun.statut')}>
                      <BadgeStatutRendezVous statut={rdv.statut} />
                    </td>
                    <td data-etiquette={t('commun.statut')}>
                      {/*
                        * CHANGEMENT DE STATUT DIRECTEMENT DANS LE PLANNING.
                        *
                        * Ce tableau etait le point d'entree du medecin, mais la
                        * seule action proposee — « Details » — menait a une page
                        * qui N'EXISTE PAS : le lien renvoyait une erreur 404.
                        * Il n'y avait donc aucun moyen de signaler une absence ou
                        * une reprogrammation depuis l'ecran ou le medecin
                        * constate ces faits.
                        *
                        * Le selecteur ci-dessous appelle l'API existante
                        * (`PUT /api/appointments/:id`, deja prevue et validee cote
                        * serveur). Il ne remplace PAS le rendez-vous : il change
                        * son statut, et c'est tout — aucun doublon n'est cree.
                        */}
                      <ChampSelection
                        nom={`statut-${rdv.id}`}
                        etiquette=""
                        value={rdv.statut}
                        options={OPTIONS_STATUT}
                        onChange={(evenement) => void changerStatut(rdv.id, evenement.target.value)}
                        {...(enCoursId === rdv.id
                          ? { erreur: t('commun.enregistrementEnCours'), disabled: true }
                          : {})}
                      />
                    </td>
                    <td data-etiquette={t('commun.actions')}>
                      {/*
                        * FICHIER PATIENT — ouvre directement le profil du patient
                        * associé au rendez-vous, en utilisant le patientId réel
                        * renvoyé par l'API. Aucun nouveau patient n'est créé.
                        */}
                      <LienBouton
                        href={`/patients/${rdv.patientId}`}
                        variante="discret"
                        taille="petite"
                      >
                        {t('patients.fiche')}
                      </LienBouton>

                      {/*
                        * SUPPRESSION — en DEUX temps, jamais au premier clic.
                        *
                        * Le bouton « Supprimer » bascule la ligne en etat de
                        * confirmation. Tant que le medecin n'a pas repondu,
                        * aucune requete n'est envoyee : c'est « Annuler » ou
                        * « Supprimer » qui decide. La confirmation SUPPRIME ne
                        * ferme pas la ligne sans appel serveur : c'est elle qui
                        * appelle `supprimerRendezVous`.
                        */}
                      {aSupprimer === rdv.id ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--espace-2)',
                            marginLeft: 'var(--espace-2)',
                          }}
                        >
                          <span className="statistique-detail">
                            {t('confirmation.supprimerRendezVous')}
                            <br />
                            <span className="encadre-avertissement">
                              {t('rendezVous.supprimerAide')}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="bouton bouton-secondaire"
                            onClick={() => setASupprimer(null)}
                            disabled={suppressionEnCours}
                          >
                            {t('commun.annuler')}
                          </button>
                          <button
                            type="button"
                            className="bouton bouton-danger-plein"
                            onClick={() => void supprimerRendezVous(rdv.id)}
                            disabled={suppressionEnCours}
                          >
                            {suppressionEnCours
                              ? t('rendezVous.suppressionEnCours')
                              : t('commun.supprimer')}
                          </button>
                        </span>
                      ) : (
                        <Bouton
                          variante="discret"
                          taille="petite"
                          onClick={() => setASupprimer(rdv.id)}
                        >
                          {t('commun.supprimer')}
                        </Bouton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )

}

/** Bornes de la periode affichee, en fonction de la vue. */
export function bornesPeriode(vue: Vue, reference: Date): { debut: Date; fin: Date } {
  const debut = new Date(reference)
  const fin = new Date(reference)

  if (vue === 'jour') {
    debut.setHours(0, 0, 0, 0)
    fin.setHours(23, 59, 59, 999)
  } else if (vue === 'semaine') {
    const jour = debut.getDay()
    const decalage = jour === 0 ? 6 : jour - 1
    debut.setDate(debut.getDate() - decalage)
    debut.setHours(0, 0, 0, 0)
    fin.setTime(debut.getTime())
    fin.setDate(fin.getDate() + 6)
    fin.setHours(23, 59, 59, 999)
  } else {
    debut.setDate(1)
    debut.setHours(0, 0, 0, 0)
    fin.setMonth(fin.getMonth() + 1, 0)
    fin.setHours(23, 59, 59, 999)
  }

  return { debut, fin }
}

/** Libelle lisible de la periode. */
function titrePeriode(vue: Vue, reference: Date): string {
  if (vue === 'jour') {
    return reference.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  if (vue === 'semaine') {
    const { debut, fin } = bornesPeriode(vue, reference)
    return `${debut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — ${fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`
  }
  return reference.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}
