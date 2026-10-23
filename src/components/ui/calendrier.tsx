'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { t } from '@content/index'

import { Bouton } from '@/components/ui/bouton'

/**
 * =============================================================================
 *  CALENDRIER DE SÉLECTION DE DATE (rapports)
 * =============================================================================
 *
 *  Sélection en TROIS étapes : jour → mois → année. Aucune frappe manuelle :
 *  le médecin clique des boutons, il ne tape jamais de chiffre.
 *
 *  PARCOURS :
 *    1. Grille de jours du mois courant du calendrier (avec en-têtes L-M-M-J-V-S-D)
 *    2. Grille de 12 mois
 *    3. Grille d'années, DÉMARRE À 2026 (exigence produit) et se navigue par
 *       blocs de 12. Les années antérieures à 2026 ne sont pas proposées :
 *       un cabinet n'a pas de rapport avant son ouverture ; les années futures
 *       restent accessibles pour la planification.
 *  Un récapitulatif « jour mois année » confirme la sélection avant validation.
 *
 *  VALEUR : la sélection est un objet `Date` réellement construit (pas une
 *  chaîne affichée re-parsée). L'API du composant reste ISO `aaaa-mm-jj`
 *  (heure locale « zéro »), sans conversion de fuseau.
 *
 *  ACCESSIBILITÉ : rôle `dialog` + `aria-modal`, titres par `aria-labelledby`,
 *  boutons réels focusables, focus posé dans la boîte à l'ouverture, Échap
 *  ferme la fenêtre, focus rendu au déclencheur à la fermeture.
 *
 *  RTL : le layout est en grille CSS direction-agnostique (les en-têtes de
 *  jours et les cellules suivent `direction` de la page), la valeur interne
 *  n'est PAS affectée par le sens de lecture.
 *
 *  THÈMES : couleurs via variables CSS existantes (sombre/clair automatiques).
 */

const JOURS_SEMAINE = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const MOIS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
]

/** Première année proposée par la grille (exigence produit : 2026). */
export const ANNEE_MINIMALE = 2026

/** Bornes raisonnables de saisie : pas de rapport avant l'ouverture du cabinet. */
const JOUR_MIN = new Date(ANNEE_MINIMALE, 0, 1)

function isoDe(date: Date): string {
  const annee = date.getFullYear()
  const mois = String(date.getMonth() + 1).padStart(2, '0')
  const jour = String(date.getDate()).padStart(2, '0')
  return `${annee}-${mois}-${jour}`
}

function dateDe(iso: string): Date | null {
  const correspond = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!correspond) return null
  const date = new Date(
    Number(correspond[1]),
    Number(correspond[2]) - 1,
    Number(correspond[3]),
  )
  // Garde-fou : `2026-02-30` est invalide ; le constructeur JS la reporte au
  // 2 mars. On refuse toute valeur reportée.
  if (
    date.getFullYear() !== Number(correspond[1]) ||
    date.getMonth() !== Number(correspond[2]) - 1 ||
    date.getDate() !== Number(correspond[3])
  ) {
    return null
  }
  return date
}

export function formaterDateFr(iso: string): string {
  const date = dateDe(iso)
  if (!date) return ''
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

interface ProprietesCalendrier {
  nom: string
  etiquette: string
  /** Date ISO `aaaa-mm-jj` ou chaîne vide. */
  valeur: string
  onChangeIso: (iso: string) => void
  requis?: boolean
  /** Bornes optionnelles, ISO. */
  minIso?: string
  maxIso?: string
}

export function CalendrierDates({
  nom,
  etiquette,
  valeur,
  onChangeIso,
  requis = false,
  minIso,
  maxIso,
}: ProprietesCalendrier): React.JSX.Element {
  const id = `calendrier-${nom}`
  const [ouvert, setOuvert] = useState(false)
  // Vue courante du calendrier (mois/année affichés), indépendante de la valeur.
  const [vue, setVue] = useState(() => {
    const existante = dateDe(valeur)
    if (existante) return { annee: existante.getFullYear(), mois: existante.getMonth() }
    return { annee: ANNEE_MINIMALE, mois: 0 }
  })
  // Étapes : 'jour' → 'mois' → 'annee'
  const [etape, setEtape] = useState<'jour' | 'mois' | 'annee'>('jour')
  // Sélection en cours : jour choisi avant confirmation.
  const [selection, setSelection] = useState<Date | null>(() => dateDe(valeur))
  const [erreur, setErreur] = useState<string | null>(null)
  const declencheurRef = useRef<HTMLButtonElement>(null)
  const boiteRef = useRef<HTMLDivElement>(null)

  // Bornes réelles.
  const minDate = minIso ? dateDe(minIso) : JOUR_MIN
  const maxDate = maxIso ? dateDe(maxIso) : null

  function ouvrir() {
    const existante = dateDe(valeur)
    setSelection(existante)
    setVue(
      existante
        ? { annee: existante.getFullYear(), mois: existante.getMonth() }
        : { annee: ANNEE_MINIMALE, mois: 0 },
    )
    setEtape('jour')
    setErreur(null)
    setOuvert(true)
  }

  function fermer(restaurerFocus = true) {
    setOuvert(false)
    if (restaurerFocus) declencheurRef.current?.focus()
  }

  // Fermeture par Échap et par clic extérieur.
  useEffect(() => {
    if (!ouvert) return
    function surTouche(evenement: KeyboardEvent) {
      if (evenement.key === 'Escape') fermer()
    }
    function surClic(evenement: MouseEvent) {
      if (boiteRef.current && !boiteRef.current.contains(evenement.target as Node)) fermer(false)
    }
    document.addEventListener('keydown', surTouche)
    document.addEventListener('mousedown', surClic)
    // Focus initial dans la boîte.
    boiteRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', surTouche)
      document.removeEventListener('mousedown', surClic)
    }
  }, [ouvert])

  function choisirJour(date: Date) {
    setSelection(date)
    setErreur(null)
  }

  function valider() {
    if (!selection) {
      setErreur(t('commun.dateRequise'))
      return
    }
    if (minDate && selection < minDate) {
      setErreur(t('commun.dateTropTot'))
      return
    }
    if (maxDate && selection > maxDate) {
      setErreur(t('commun.dateTropTard'))
      return
    }
    onChangeIso(isoDe(selection))
    fermer()
  }

  function effacer() {
    setSelection(null)
    setErreur(null)
    onChangeIso('')
    fermer()
  }

  // Grille de lundi-premier.
  const grilleJours = useMemo(() => {
    const premier = new Date(vue.annee, vue.mois, 1)
    // getDay(): 0 = dimanche → décalage pour une grille commençant lundi.
    const decalage = (premier.getDay() + 6) % 7
    const cellules: Array<Date | null> = Array(decalage).fill(null)
    const dernierJour = new Date(vue.annee, vue.mois + 1, 0).getDate()
    for (let jour = 1; jour <= dernierJour; jour += 1) {
      cellules.push(new Date(vue.annee, vue.mois, jour))
    }
    return cellules
  }, [vue])

  const blocAnnees = Math.floor((vue.annee - ANNEE_MINIMALE) / 12) * 12
  const anneesBloc = Array.from({ length: 12 }, (_, i) => ANNEE_MINIMALE + blocAnnees + i)

  const libelleBouton = valeur ? formaterDateFr(valeur) : t('commun.choisirDate')

  return (
    <div className="champ">
      <label htmlFor={id} className={`champ-etiquette${requis ? ' champ-obligatoire' : ''}`}>
        {etiquette}
      </label>
      <button
        ref={declencheurRef}
        id={id}
        type="button"
        className="champ-controle"
        style={{ textAlign: 'start' }}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        onClick={ouvrir}
      >
        {libelleBouton}
      </button>
      {ouvert ? (
        <div
          ref={boiteRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-titre`}
          tabIndex={-1}
          className="calendrier-boite"
          style={{
            position: 'absolute',
            zIndex: 20,
            background: 'var(--fond-carte)',
            border: '1px solid var(--bordure)',
            borderRadius: 'var(--rayon, 8px)',
            padding: 'var(--espace-3)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            minWidth: '18rem',
          }}
        >
          <div
            id={`${id}-titre`}
            style={{ fontWeight: 600, marginBottom: 'var(--espace-2)' }}
          >
            {etiquette}
          </div>

          {/* ── ÉTAPE 1 : JOURS ─────────────────────────────────────────────── */}
          {etape === 'jour' ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--espace-2)',
                  marginBottom: 'var(--espace-2)',
                }}
              >
                <button
                  type="button"
                  className="bouton bouton-discret"
                  aria-label={t('commun.moisPrecedentCal')}
                  onClick={() =>
                    setVue((v) =>
                      v.mois === 0 ? { annee: v.annee - 1, mois: 11 } : { ...v, mois: v.mois - 1 },
                    )
                  }
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="bouton bouton-discret"
                  onClick={() => setEtape('mois')}
                >
                  {MOIS_FR[vue.mois]} {vue.annee}
                </button>
                <button
                  type="button"
                  className="bouton bouton-discret"
                  aria-label={t('commun.moisSuivantCal')}
                  onClick={() =>
                    setVue((v) =>
                      v.mois === 11 ? { annee: v.annee + 1, mois: 0 } : { ...v, mois: v.mois + 1 },
                    )
                  }
                >
                  ›
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)',
                  gap: '2px',
                  marginBottom: 'var(--espace-2)',
                }}
              >
                {JOURS_SEMAINE.map((lettre, index) => (
                  <span
                    key={`entete-${index}`}
                    style={{
                      textAlign: 'center',
                      fontSize: 12,
                      color: 'var(--texte-tertiaire)',
                    }}
                  >
                    {lettre}
                  </span>
                ))}
                {grilleJours.map((date, index) =>
                  date === null ? (
                    <span key={`vide-${index}`} />
                  ) : (
                    <button
                      key={isoDe(date)}
                      type="button"
                      onClick={() => choisirJour(date)}
                      style={{
                        padding: '0.35rem 0',
                        borderRadius: 6,
                        border:
                          selection && isoDe(selection) === isoDe(date)
                            ? '1px solid var(--accent)'
                            : '1px solid transparent',
                        background:
                          selection && isoDe(selection) === isoDe(date)
                            ? 'var(--accent-fonce, var(--accent))'
                            : 'transparent',
                        color: 'var(--texte)',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                      aria-pressed={selection ? isoDe(selection) === isoDe(date) : undefined}
                      aria-current={
                        selection && isoDe(selection) === isoDe(date) ? 'date' : undefined
                      }
                    >
                      {date.getDate()}
                    </button>
                  ),
                )}
              </div>
            </>
          ) : null}

          {/* ── ÉTAPE 2 : MOIS ──────────────────────────────────────────────── */}
          {etape === 'mois' ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--espace-1)',
              }}
            >
              {MOIS_FR.map((nomMois, index) => (
                <button
                  key={nomMois}
                  type="button"
                  onClick={() => {
                    setVue((v) => ({ ...v, mois: index }))
                    setEtape('jour')
                  }}
                  style={{
                    padding: '0.4rem',
                    borderRadius: 6,
                    border: '1px solid var(--bordure)',
                    background:
                      vue.mois === index ? 'var(--accent-fonce, var(--accent))' : 'transparent',
                    color: 'var(--texte)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {nomMois}
                </button>
              ))}
              <button
                type="button"
                className="bouton bouton-discret"
                style={{ gridColumn: '1 / -1' }}
                onClick={() => setEtape('annee')}
              >
                {t('commun.changerAnnee')} — {vue.annee}
              </button>
            </div>
          ) : null}

          {/* ── ÉTAPE 3 : ANNÉES (blocs de 12, à partir de 2026) ────────────── */}
          {etape === 'annee' ? (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--espace-2)',
                }}
              >
                <button
                  type="button"
                  className="bouton bouton-discret"
                  disabled={blocAnnees <= 0}
                  aria-label={t('commun.anneesPrecedentes')}
                  onClick={() => setVue((v) => ({ ...v, annee: v.annee - 12 }))}
                >
                  ‹
                </button>
                <span style={{ fontWeight: 600 }}>
                  {ANNEE_MINIMALE + blocAnnees} – {ANNEE_MINIMALE + blocAnnees + 11}
                </span>
                <button
                  type="button"
                  className="bouton bouton-discret"
                  aria-label={t('commun.anneesSuivantes')}
                  onClick={() => setVue((v) => ({ ...v, annee: v.annee + 12 }))}
                >
                  ›
                </button>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'var(--espace-1)',
                }}
              >
                {anneesBloc.map((annee) => (
                  <button
                    key={annee}
                    type="button"
                    onClick={() => {
                      setVue((v) => ({ ...v, annee }))
                      setEtape('mois')
                    }}
                    style={{
                      padding: '0.4rem',
                      borderRadius: 6,
                      border: '1px solid var(--bordure)',
                      background: vue.annee === annee ? 'var(--accent-fonce, var(--accent))' : 'transparent',
                      color: 'var(--texte)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {annee}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Récapitulatif + actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--espace-2)',
              marginTop: 'var(--espace-2)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--texte-secondaire)' }}>
              {selection ? formaterDateFr(isoDe(selection)) : t('commun.aucuneDate')}
            </span>
            <div style={{ display: 'flex', gap: 'var(--espace-2)' }}>
              <Bouton type="button" variante="discret" onClick={effacer}>
                {t('commun.effacer')}
              </Bouton>
              <Bouton type="button" variante="principal" onClick={valider} disabled={!selection}>
                {t('commun.confirmer')}
              </Bouton>
            </div>
          </div>
          {erreur ? (
            <p role="alert" style={{ color: 'var(--erreur-texte, #b3261e)', margin: 0, fontSize: 13 }}>
              {erreur}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
