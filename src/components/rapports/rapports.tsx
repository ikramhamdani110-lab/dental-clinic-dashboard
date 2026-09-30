'use client'

import { useCallback, useMemo, memo, useState } from 'react'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { t, tf } from '@content/index'
import { formaterMontant } from '@backend/domain/finance'

import { Bouton, LienBouton } from '@/components/ui/bouton'
import { ChampDate, ChampSelection } from '@/components/ui/champ'
import { Pagination } from '@/components/patients/liste-patients'
import { useRequete } from '@/lib/hooks/use-requete'

/**
 * =============================================================================
 *  RAPPORTS — SYNTHESE FINANCIERE DE LA CLINIQUE (§27)
 * =============================================================================
 *
 *  Cette page est LA vue financiere de l'application : les paiements se creent
 *  et se consultent depuis la fiche du patient, mais c'est ici que le medecin
 *  lit le chiffre d'affaires de son cabinet.
 *
 *  Toutes les valeurs proviennent d'AGREGATIONS EN BASE (§18, §27). Le
 *  graphique recueille UN POINT PAR MOIS, jamais une ligne par paiement : la
 *  page reste rapide quelle que soit l'anciennete du cabinet (§35).
 *
 *  La periode se compose de deux mecanismes complementaires :
 *    - le FILTRE de periode, qui pilote les indicateurs de la periode choisie ;
 *    - l'ANNEE, qui pilote la courbe annuelle complete (12 mois).
 *
 *  AUCUN PDF : les rapports sont consultables a l'ecran (§45).
 */

type PeriodeRapport = '7-jours' | '30-jours' | 'annee' | 'annee-precedente' | 'personnalisee'

interface SyntheseFinanciere {
  periode: { debut: string; fin: string }
  totalRevenusCentimes: number
  nombrePaiements: number
  montantRestantCentimes: number
  revenusAnneeCentimes: number
  anneeReference: number
  /**
   * Revenus du mois qui contient la fin de la periode. Conserves pour la carte
   * « comparaison avec le mois precedent », qui est une lecture MENSUELLE et
   * reste donc sur une maille de mois.
   */
  revenusMoisCentimes: number
  revenusMoisPrecedentCentimes: number
  moisPrecedent: { annee: number; mois: number }
  variationPourcent: number | null
  comparaisonDisponible: boolean
}

/**
 * Evolution des revenus.
 *
 * `annee` est renseigne quand la courbe decrit une ANNEE CIVILE (menu Annee),
 * `periode` quand elle suit la fenetre du FILTRE DE PERIODE. `granularite` dit
 * comment lire chaque point : un par jour, ou un par mois.
 */
interface EvolutionRevenus {
  annee: number | null
  granularite: 'jour' | 'mois'
  periode: { debut: string; fin: string } | null
  totalCentimes: number
  points: Array<{ mois: number; annee: number; jour: number | null; totalCentimes: number }>
}

interface SoldePatient {
  patientId: string
  nom: string
  prenom: string
  telephone: string
  totalFactureCentimes: number
  totalPayeCentimes: number
  resteAPayerCentimes: number
}

interface RapportSoldes {
  elements: SoldePatient[]
  total: number
  page: number
  pages: number
}

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

const ANNEE_COURANTE = new Date().getFullYear()

/**
 * Champs de dates pour la période personnalisée.
 *
 * ROOT CAUSE DU BUG DE SAISIE :
 *   Les deux champs etaient des <input type="date"> lies a un etat controle du
 *   composant parent. Ce type d'input n'est pas saisissable au clavier de facon
 *   continue : le navigateur impose ses propres segments, reecrit la valeur a
 *   chaque frappe, et le composant controle remonte alors la page. Resultat :
 *   chiffres supprimes, curseur deplace, date remplacee en plein milieu de la
 *   saisie, sur « Du » comme sur « Au ».
 *
 *   Correction : chaque date est desormais saisie par `ChampDate`, un champ de
 *   TEXTE a frappe libre. La frappe vit dans l'etat local du champ et n'est
 *   convertie en ISO (aaaa-mm-jj) qu'a la SORTIE du champ, donc jamais pendant
 *   la saisie. Les deux champs sont deux instances independantes : taper dans
 *   l'un ne peut pas toucher l'autre.

 *   `React.memo` isole en outre ce bloc : les mises a jour asynchrones des hooks
 *   parents ne le re-rendent pas pendant la frappe.
 */
const ChampsDatesPersonnalisees = memo(function ChampsDatesPersonnalisees({
  du,
  au,
  onChangeDu,
  onChangeAu,
  onAfficher,
}: {
  du: string
  au: string
  onChangeDu: (valeur: string) => void
  onChangeAu: (valeur: string) => void
  onAfficher: () => void
}): React.JSX.Element {
  return (
    <>
      <div style={{ minWidth: '10rem' }}>
        <ChampDate
          nom="periode-du"
          etiquette={t('rapports.du')}
          valeur={du}
          onChangeIso={onChangeDu}
          requis
        />
      </div>
      <div style={{ minWidth: '10rem' }}>
        <ChampDate
          nom="periode-au"
          etiquette={t('rapports.au')}
          valeur={au}
          onChangeIso={onChangeAu}
          requis
        />
      </div>
      {/*
        « Afficher » APPLIQUE reellement la periode : les bornes sont
        enregistrees, ce qui change les parametres de requete et
        declenche un NOUVEL appel a l'API (voir `periodeAppliquee`).

        `type="button"` est explicite : sans lui, un bouton place
        dans un formulaire serait de type `submit` par defaut et
        declencherait une navigation au lieu de l'action voulue.
      */}
      <Bouton
        type="button"
        variante="secondaire"
        onClick={onAfficher}
        disabled={!du || !au}
      >
        {t('rapports.afficher')}
      </Bouton>
    </>
  )
})

export function Rapports(): React.JSX.Element {
  const [periode, setPeriode] = useState<PeriodeRapport>('30-jours')
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')
  // Bornes effectivement appliquees : modifiees par le bouton « Afficher », afin
  // qu'une periode personnalisee incomplete ne declenche pas de requete inutile.
  const [periodeAppliquee, setPeriodeAppliquee] = useState<{ du: string; au: string } | null>(null)
  const [annee, setAnnee] = useState(ANNEE_COURANTE)

  /**
   * Callback stable pour le bouton « Afficher » de la période personnalisée.
   * Wrappé dans useCallback afin que la référence ne change que quand `du` ou
   * `au` changent — garantissant que `React.memo` dans `ChampsDatesPersonnalisees`
   * ne re-rende pas le composant lors des mises à jour asynchrones du parent.
   */
  const handleAfficher = useCallback(() => {
    setPeriodeAppliquee({ du, au })
  }, [du, au])

  /*
   * Le MENU ANNUEL ne sert qu'a un cas : quand la periode choisie est « cette
   * annee » ou « annee precedente », il permet de comparer une annee precise.
   *
   * En dehors de ces deux choix, la courbe suit le FILTRE DE PERIODE, et le menu
   * annuel n'a plus d'objet : il est donc masque plus bas. Cela evite deux
   * commandes concurrentes sur le meme graphique, source de confusion.
   */
  const anneePiloteeParLaPeriode = periode === 'annee' || periode === 'annee-precedente'

  /**
   * Parametres de la periode, partages par la synthese ET l'evolution.
   *
   * Une periode personnalisee n'est transmise qu'une fois APPLIQUEE (bouton
   * « Afficher ») : tant que les deux dates ne sont pas saisies, aucune requete
   * n'est emise avec des bornes incompletes.
   */
  const parametresPeriode = useMemo(() => {
    const parametres = new URLSearchParams({ periode })
    if (periode === 'personnalisee' && periodeAppliquee) {
      parametres.set('du', periodeAppliquee.du)
      parametres.set('au', periodeAppliquee.au)
    }
    return parametres.toString()
  }, [periode, periodeAppliquee])

  /** Faux tant qu'une periode personnalisee n'est pas complete. */
  const periodeExploitable = !(periode === 'personnalisee' && !periodeAppliquee)

  const synthese = useRequete<SyntheseFinanciere>(
    periodeExploitable ? `/api/reports/revenue?rapport=synthese&${parametresPeriode}` : null,
  )

  /*
   * EVOLUTION — ELLE SUIT LA PERIODE, PAS LE MONTAGE.
   *
   *   - periode « cette annee » ou « annee precedente » : la courbe decrit
   *     l'annee choisie dans le menu (12 points mensuels), ce qui permet de la
   *     comparer d'une annee a l'autre.
   *
   *   - toute autre periode (7 jours, 30 jours, personnalisee) : la courbe decrit
   *     EXACTEMENT la fenetre selectionnee, avec une granularite adaptee.
   *
   * C'est la correction du defaut principal : auparavant la requete portait
   * toujours sur l'annee du menu, donc changer de periode ne modifiait pas le
   * graphique.
   */
  const evolution = useRequete<EvolutionRevenus>(
    periodeExploitable
      ? anneePiloteeParLaPeriode
        ? `/api/reports/revenue?rapport=evolution&annee=${annee}`
        : `/api/reports/revenue?rapport=evolution&${parametresPeriode}`
      : null,
  )
  const annees = useRequete<{ annees: number[] }>('/api/reports/revenue?rapport=annees')

  const optionsAnnees = annees.donnees?.annees ?? [ANNEE_COURANTE]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-5)' }}>
      <SyntheseFinanciereCartes
        synthese={synthese.donnees}
        chargement={synthese.chargement}
        erreur={synthese.erreur}
        onRecharger={synthese.recharger}
      />

      {/* Filtre de periode */}
      <section className="carte" aria-labelledby="titre-filtre-periode">
        <div className="carte-entete">
          <h2 className="carte-titre" id="titre-filtre-periode">
            {t('rapports.periode')}
          </h2>
        </div>
        <div className="carte-corps">
          <div className="barre-outils">
            <div className="barre-outils-groupe">
              <div style={{ minWidth: '13rem' }}>
                <ChampSelection
                  nom="periode-rapport"
                  etiquette={t('rapports.periode')}
                  value={periode}
                  onChange={(evenement) => {
                    const valeur = evenement.target.value as PeriodeRapport
                    setPeriode(valeur)
                    // Revenir sur une periode predefinie annule la periode
                    // personnalisee precedemment appliquee.
                    if (valeur !== 'personnalisee') setPeriodeAppliquee(null)
                  }}
                  options={[
                    { valeur: '7-jours', libelle: t('rapports.septJours') },
                    { valeur: '30-jours', libelle: t('rapports.trenteJours') },
                    { valeur: 'annee', libelle: t('rapports.cetteAnnee') },
                    { valeur: 'annee-precedente', libelle: t('rapports.anneePrecedente') },
                    { valeur: 'personnalisee', libelle: t('rapports.personnalise') },
                  ]}
                />
              </div>

              {periode === 'personnalisee' ? (
                <ChampsDatesPersonnalisees
                  du={du}
                  au={au}
                  onChangeDu={setDu}
                  onChangeAu={setAu}
                  onAfficher={handleAfficher}
                />
              ) : null}
            </div>

            {synthese.donnees ? (
              <span className="entete-page-sous-titre">
                {new Date(synthese.donnees.periode.debut).toLocaleDateString('fr-FR')} —{' '}
                {new Date(synthese.donnees.periode.fin).toLocaleDateString('fr-FR')}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* Graphique principal : evolution des revenus sur la periode choisie */}
      <section className="carte" aria-labelledby="titre-evolution-revenus">
        <div className="carte-entete">
          <div>
            <h2 className="carte-titre" id="titre-evolution-revenus">
              {t('rapports.evolutionRevenus')}
            </h2>
            <p className="entete-page-sous-titre">
              {/*
                Le sous-titre decrit ce que la courbe montre VRAIMENT. Il suit
                donc la granularite renvoyee par le serveur : « par jour » sur une
                fenetre courte, « par mois » au-dela.
              */}
              {evolution.donnees?.granularite === 'jour'
                ? t('rapports.evolutionParJour')
                : t('rapports.evolutionRevenusSousTitre')}
            </p>
          </div>
          {/*
            Le menu ANNUEL n'apparait QUE pour les periodes « cette annee » et
            « annee precedente » : ce sont les seules ou le medecin choisit une
            annee precise. Ailleurs, la courbe suit le filtre de periode et ce
            menu n'aurait aucun effet — l'afficher laisserait croire le contraire.
          */}
          {anneePiloteeParLaPeriode ? (
            <div style={{ minWidth: '8rem' }}>
              <ChampSelection
                nom="annee-rapport"
                etiquette={t('rapports.annee')}
                value={String(annee)}
                onChange={(evenement) => setAnnee(Number.parseInt(evenement.target.value, 10))}
                options={optionsAnnees.map((valeur) => ({
                  valeur: String(valeur),
                  libelle: String(valeur),
                }))}
              />
            </div>
          ) : null}
        </div>
        <div className="carte-corps">
          {evolution.chargement ? (
            <div className="etat-vide">
              <span className="rotation" aria-hidden="true" />
              <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
            </div>
          ) : null}

          {evolution.erreur ? (
            <div className="encadre-erreur" role="alert">
              <p>{evolution.erreur}</p>
              <button type="button" className="bouton-lien" onClick={evolution.recharger}>
                {t('erreurs.reessayer')}
              </button>
            </div>
          ) : null}

          {/*
            Trois cas, dans cet ordre :
              - rien a afficher (chargement en cours, ou donnees absentes) ;
              - aucun revenu sur la periode : message d'etat vide ;
              - des revenus : la courbe.

            Le test est `donnees === null` ET le cas `undefined` : `useRequete`
            expose `null` avant le premier chargement, mais la valeur peut aussi
            etre absente selon le chemin de rendu. Un test unique `!donnees`
            couvre les deux sans ambiguite.
          */}
          {!evolution.donnees || evolution.chargement ? null : evolution.donnees.totalCentimes === 0 ? (
            <div className="etat-vide">
              <p className="etat-vide-texte">{t('rapports.aucunRevenu')}</p>
            </div>
          ) : (
            <CourbeRevenus
              points={evolution.donnees.points}
              granularite={evolution.donnees.granularite}
            />
          )}
        </div>
      </section>

      {/* Comparaison avec le mois precedent */}
      {synthese.donnees?.comparaisonDisponible ? (
        <ComparaisonMois synthese={synthese.donnees} />
      ) : null}

      {/* Soldes patients : montants restants calcules par la base */}
      <SoldesPatients />
    </div>
  )
}

function SyntheseFinanciereCartes({
  synthese,
  chargement,
  erreur,
  onRecharger,
}: {
  synthese: SyntheseFinanciere | null
  chargement: boolean
  erreur: string | null
  onRecharger: () => void
}): React.JSX.Element {
  if (chargement) {
    return (
      <div className="etat-vide">
        <span className="rotation" aria-hidden="true" />
        <p className="etat-vide-texte">{t('tableaux.chargement')}</p>
      </div>
    )
  }

  if (erreur || !synthese) {
    return (
      <div className="encadre-erreur" role="alert">
        <p>{erreur ?? t('erreurs.erreurInterne')}</p>
        <button type="button" className="bouton-lien" onClick={onRecharger}>
          {t('erreurs.reessayer')}
        </button>
      </div>
    )
  }

  return (
    <section aria-label={t('rapports.sousTitre')}>
      <div className="grille-statistiques">
        <div className="statistique">
          <span className="statistique-etiquette">{t('rapports.totalRevenus')}</span>
          <span className="statistique-valeur">
            {formaterMontant(synthese.totalRevenusCentimes)}
          </span>
          <span className="statistique-detail">{t('rapports.totalRevenusAide')}</span>
        </div>
        <div className="statistique">
          <span className="statistique-etiquette">{t('rapports.paiementsRecus')}</span>
          <span className="statistique-valeur">{synthese.nombrePaiements}</span>
          <span className="statistique-detail">{t('rapports.paiementsRecusAide')}</span>
        </div>
        <div className="statistique">
          <span className="statistique-etiquette">{t('rapports.montantRestant')}</span>
          <span
            className="statistique-valeur"
            style={
              synthese.montantRestantCentimes > 0
                ? { color: 'var(--avertissement-texte)' }
                : undefined
            }
          >
            {formaterMontant(synthese.montantRestantCentimes)}
          </span>
          <span className="statistique-detail">{t('rapports.montantRestantAide')}</span>
        </div>
        <div className="statistique">
          <span className="statistique-etiquette">{t('rapports.revenusDeLAnnee')}</span>
          <span className="statistique-valeur">
            {formaterMontant(synthese.revenusAnneeCentimes)}
          </span>
          {/*
            L'annee affichee est celle que le serveur a retenue comme reference :
            l'annee civile contenant la FIN de la periode choisie. Le chiffre et
            l'annee viennent donc de la meme agregation et ne peuvent pas diverger.
          */}
          <span className="statistique-detail">{synthese.anneeReference}</span>
        </div>
      </div>
    </section>
  )
}

/**
 * Courbe des revenus.
 *
 * Un graphique en AIRE lisse : la tendance se lit d'un coup d'oeil, sans
 * surcharge visuelle. Un seul graphique sur la page (§25 : « ne pas surcharger »).
 *
 * DEUX GRANULARITES
 *
 *   La serie vient du serveur, qui choisit la maille selon l'etendue de la
 *   periode : un point par JOUR sur une fenetre courte, un point par MOIS
 *   au-dela. L'etiquette de l'axe suit donc cette maille :
 *
 *     - 'jour' : « 12/09 » — le quantieme suffit, l'annee est connue par la
 *       periode affichee juste au-dessus ;
 *     - 'mois' : « Sep » — la lecture mensuelle reste identique a avant.
 */
function CourbeRevenus({
  points,
  granularite,
}: {
  points: Array<{ mois: number; annee: number; jour: number | null; totalCentimes: number }>
  granularite: 'jour' | 'mois'
}): React.JSX.Element {
  const donnees = points.map((point) => ({
    etiquette:
      granularite === 'jour'
        ? `${String(point.jour ?? 1).padStart(2, '0')}/${String(point.mois + 1).padStart(2, '0')}`
        : (MOIS_FR[point.mois]?.slice(0, 3) ?? ''),
    total: point.totalCentimes,
  }))

  return (
    <div className="graphique-conteneur graphique-conteneur-large">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={donnees} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="degrade-revenus" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--bordure)" vertical={false} />
          <XAxis
            dataKey="etiquette"
            tick={{ fill: 'var(--texte-tertiaire)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--bordure)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--texte-tertiaire)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={72}
            // Les montants sont en centimes : les graduations affichent des dinars.
            tickFormatter={(valeur: number) => `${Math.round(valeur / 100)}`}
          />
          <Tooltip
            cursor={{ stroke: 'var(--bordure-forte)' }}
            contentStyle={{
              background: 'var(--fond-surface-eleve)',
              border: '1px solid var(--bordure)',
              borderRadius: 'var(--rayon-moyen)',
              color: 'var(--texte-principal)',
              fontSize: 13,
            }}
            formatter={(valeur: number) => [formaterMontant(valeur), t('rapports.revenus')]}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#degrade-revenus)"
            dot={{ r: 2.5, fill: 'var(--accent)', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Comparaison avec le mois precedent.
 *
 * N'est affichee QUE si le mois precedent a genere des revenus : sans reference,
 * un pourcentage serait trompeur. Les deux montants sont ceux de la base.
 */
function ComparaisonMois({
  synthese,
}: {
  synthese: SyntheseFinanciere
}): React.JSX.Element {
  const variation = synthese.variationPourcent ?? 0
  const nomMoisPrecedent = `${MOIS_FR[synthese.moisPrecedent.mois]} ${synthese.moisPrecedent.annee}`
  const arrondi = Math.abs(variation).toFixed(1)
  const classeVariation =
    variation > 0 ? 'solde-valeur-solde' : variation < 0 ? 'solde-valeur-attention' : ''

  return (
    <section className="carte" aria-labelledby="titre-comparaison-mois">
      <div className="carte-entete">
        <h2 className="carte-titre" id="titre-comparaison-mois">
          {t('rapports.comparaisonMoisPrecedent')}
        </h2>
      </div>
      <div className="carte-corps">
        <div className="grille-solde">
          <div className="solde-element">
            <span className="solde-etiquette">{t('rapports.revenusCeMois')}</span>
            <span className="solde-valeur">
              {formaterMontant(synthese.revenusMoisCentimes)}
            </span>
          </div>
          <div className="solde-element">
            <span className="solde-etiquette">
              {t('rapports.moisPrecedent')} — {nomMoisPrecedent}
            </span>
            <span className="solde-valeur">
              {formaterMontant(synthese.revenusMoisPrecedentCentimes)}
            </span>
          </div>
          <div className="solde-element">
            <span className="solde-etiquette">{t('rapports.evolutionRevenus')}</span>
            <span className={`solde-valeur ${classeVariation}`}>
              {variation > 0
                ? tf('rapports.variationHausse', { pourcent: arrondi })
                : variation < 0
                  ? tf('rapports.variationBaisse', { pourcent: arrondi })
                  : t('rapports.variationStable')}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Soldes patients — montants restants a recevoir.
 *
 * Le calcul (facture - paye), le filtre des soldes positifs, le tri et la
 * pagination sont entierement realises EN BASE (§27, §35) : le navigateur ne
 * recoit que la page affichee.
 */
function SoldesPatients(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const { donnees, chargement, erreur, recharger } = useRequete<RapportSoldes>(
    `/api/reports/revenue?rapport=soldes-patients&page=${page}&taille=25`,
  )

  return (
    <section className="carte" aria-labelledby="titre-soldes-patients">
      <div className="carte-entete">
        <h2 className="carte-titre" id="titre-soldes-patients">
          {t('rapports.soldesPositifs')}
        </h2>
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
          <p className="etat-vide-titre">{t('rapports.aucunSolde')}</p>
        </div>
      ) : null}

      {donnees && donnees.elements.length > 0 ? (
        <>
          <div className="tableau-conteneur">
            <table className="tableau tableau-cartes">
              <thead>
                <tr>
                  <th scope="col">{t('rapports.patient')}</th>
                  <th scope="col">{t('patients.telephone')}</th>
                  <th scope="col" className="tableau-numerique">
                    {t('rapports.totalDu')}
                  </th>
                  <th scope="col" className="tableau-numerique">
                    {t('patients.totalPaye')}
                  </th>
                  <th scope="col" className="tableau-numerique">
                    {t('rapports.resteAPayer')}
                  </th>
                  <th scope="col">{t('commun.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {donnees.elements.map((patient) => (
                  <tr key={patient.patientId}>
                    <td data-etiquette={t('rapports.patient')}>
                      {patient.prenom} {patient.nom}
                    </td>
                    <td data-etiquette={t('patients.telephone')}>{patient.telephone}</td>
                    <td data-etiquette={t('rapports.totalDu')} className="tableau-numerique">
                      {formaterMontant(patient.totalFactureCentimes)}
                    </td>
                    <td data-etiquette={t('patients.totalPaye')} className="tableau-numerique">
                      {formaterMontant(patient.totalPayeCentimes)}
                    </td>
                    <td
                      data-etiquette={t('rapports.resteAPayer')}
                      className="tableau-numerique"
                      style={{ color: 'var(--avertissement-texte)', fontWeight: 600 }}
                    >
                      {formaterMontant(patient.resteAPayerCentimes)}
                    </td>
                    <td data-etiquette={t('commun.actions')}>
                      {/* Le reglement se fait depuis la fiche du patient : c'est
                          la seule porte d'entree du paiement (§16, §27). */}
                      <LienBouton
                        href={`/patients/${patient.patientId}`}
                        variante="secondaire"
                        taille="petite"
                      >
                        {t('patients.fiche')}
                      </LienBouton>
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
    </section>
  )
}
