'use client'

import { useMemo, useState } from 'react'

import { formaterMontant, parseMontantEnCentimes } from '@backend/domain/finance'

import { useRequeteFinanciere } from '@/lib/hooks/use-requete-financiere'
import { genererCleAntiDoublon, messageErreur, requeteFinanciere } from '@/lib/finances-api-client'
import { DeconnexionFinances } from '@/components/finances/deconnexion-finances'

/**
 * =============================================================================
 *  TABLEAU DE BORD FINANCIER — TROIS TOTAUX + DÉPENSES (§finances-v4)
 * =============================================================================
 *
 *  L'écran répond à UNE question : « où en est l'argent du cabinet ? »
 *
 *    [ VERT  + ]  Paiements reçus          — encaissements clinique de la période
 *    [ ORANGE   ]  Dettes des patients     — ce qu'on nous doit encore (solde GLOBAL)
 *    [ ROUGE − ]  Dépenses de la clinique — achats et charges du cabinet
 *
 *  Chaque boîte est CLIQUABLE et déplie la liste détaillée correspondante.
 *  Les trois couleurs ont le MÊME sens partout : vert = argent reçu,
 *  orange = dette patient, rouge = argent dépensé.
 *
 *  LE BOUTON « + » sert à enregistrer une DÉPENSE DE LA CLINIQUE (achat de
 *  matériel, fournitures, maintenance…). Il n'a JAMAIS traité des finances
 *  personnelles — cette notion a été retirée entièrement (§finances-v4).
 *  Une dépense créée ici rejoint la table `expenses` existante : elle
 *  alimente la boîte rouge, respecte le filtre de période, et ne touche
 *  JAMAIS aux paiements patients ni aux dettes.
 *
 *  LES PAIEMENTS REÇUS proviennent EXCLUSIVEMENT des encaissements saisis par
 *  la secrétaire (table `payments`, statut VALIDE, hors corbeille) : ce site
 *  ne les recrée jamais — aucun doublon possible, il ne fait que LIRE.
 *
 *  LES DETTES NE SONT JAMAIS UN REVENU : la boîte orange affiche le solde
 *  global « facturé − payé », calculé côté serveur avec les règles métier
 *  existantes, et jamais additionné aux montants reçus.
 */

interface Synthese {
  periode: { debut: string; fin: string }
  revenusPaiementsCentimes: number
  nombrePaiements: number
  depensesCentimes: number
  restantDuCentimes: number
  mention: string
}

type Periode = 'aujourdhui' | '7-jours' | '30-jours' | 'mois' | 'annee' | 'annee-precedente' | 'personnalisee'

const OPTIONS_PERIODE: Array<{ valeur: Periode; libelle: string }> = [
  { valeur: 'aujourdhui', libelle: "Aujourd'hui" },
  { valeur: '7-jours', libelle: '7 derniers jours' },
  { valeur: '30-jours', libelle: '30 derniers jours' },
  { valeur: 'mois', libelle: 'Ce mois' },
  { valeur: 'annee', libelle: 'Cette année' },
  { valeur: 'annee-precedente', libelle: "L'année passée" },
  { valeur: 'personnalisee', libelle: 'Période précise' },
]

type BoiteOuverte = 'paiements' | 'dettes' | 'depenses' | null

export function TableauBordFinancier(): React.JSX.Element {
  const [periode, setPeriode] = useState<Periode>('mois')
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')
  const [plageValidee, setPlageValidee] = useState({ du: '', au: '' })
  const [boiteOuverte, setBoiteOuverte] = useState<BoiteOuverte>(null)
  const [formulaireDepenseOuvert, setFormulaireDepenseOuvert] = useState(false)

  const periodeEffective: Periode =
    periode === 'personnalisee' && plageValidee.du && plageValidee.au
      ? 'personnalisee'
      : periode === 'personnalisee'
        ? 'mois'
        : periode

  const params = new URLSearchParams({ periode: periodeEffective })
  if (periodeEffective === 'personnalisee') {
    params.set('du', plageValidee.du)
    params.set('au', plageValidee.au)
  }

  const { donnees, chargement, erreur, recharger } = useRequeteFinanciere<Synthese>(
    `/api/finances/summary?${params.toString()}`,
  )

  function appliquerPlage(evenement: React.FormEvent<HTMLFormElement>): void {
    evenement.preventDefault()
    if (du && au && au >= du) setPlageValidee({ du, au })
  }

  function basculerBoite(boite: Exclude<BoiteOuverte, null>): void {
    setBoiteOuverte((actuelle) => (actuelle === boite ? null : boite))
  }

  return (
    <div className="finances-page">
      {/* ── EN-TÊTE DE PAGE ──────────────────────────────────────────────────
          Titre + sous-titre à gauche ; médecin + déconnexion à droite
          (rendus dans le bandeau, cf. layout). Ici : titre, sous-titre et
          l'action « + Nouvelle dépense ». */}
      <header className="finances-entete">
        <div>
          <h1 className="finances-titre">Vue d&rsquo;ensemble</h1>
          <p className="finances-sous-titre">Suivi financier de la clinique</p>
        </div>
        <div className="finances-entete-actions">
          <button
            type="button"
            className="finances-bouton-plus"
            onClick={() => setFormulaireDepenseOuvert(true)}
          >
            <span className="finances-plus-sign" aria-hidden="true">+</span>
            Nouvelle dépense
          </button>
          <DeconnexionFinances />
        </div>
      </header>

      {formulaireDepenseOuvert ? (
        <FormulaireDepenseClinique
          onFermer={() => setFormulaireDepenseOuvert(false)}
          onSucces={recharger}
        />
      ) : null}

      {chargement && !donnees ? <p className="finances-mention">Chargement…</p> : null}

      {erreur ? (
        <div role="alert" className="finances-erreur">
          <p>{erreur}</p>
          <button type="button" onClick={recharger}>Réessayer</button>
        </div>
      ) : null}

      {donnees ? (
        <>
          {/* ── LES TROIS BOÎTES ───────────────────────────────────────────── */}
          <div className="finances-boites">
            <button
              type="button"
              className="finances-boite finances-boite-recu"
              aria-expanded={boiteOuverte === 'paiements'}
              onClick={() => basculerBoite('paiements')}
            >
              <span className="finances-boite-icone" aria-hidden="true">↗</span>
              <span className="finances-boite-libelle">Paiements reçus</span>
              <span className="finances-boite-montant">
                {formaterMontant(donnees.revenusPaiementsCentimes)}
              </span>
              <span className="finances-boite-detail">
                {donnees.nombrePaiements} paiement(s) validé(s) — cliquer pour la liste
              </span>
            </button>

            <button
              type="button"
              className="finances-boite finances-boite-dette"
              aria-expanded={boiteOuverte === 'dettes'}
              onClick={() => basculerBoite('dettes')}
            >
              <span className="finances-boite-icone" aria-hidden="true">◌</span>
              <span className="finances-boite-libelle">Dettes des patients</span>
              <span className="finances-boite-montant">
                {formaterMontant(donnees.restantDuCentimes)}
              </span>
              <span className="finances-boite-detail">
                Solde global à recevoir — pas un revenu — cliquer pour la liste
              </span>
            </button>

            <button
              type="button"
              className="finances-boite finances-boite-depense"
              aria-expanded={boiteOuverte === 'depenses'}
              onClick={() => basculerBoite('depenses')}
            >
              <span className="finances-boite-icone" aria-hidden="true">↘</span>
              <span className="finances-boite-libelle">Dépenses de la clinique</span>
              <span className="finances-boite-montant">
                {formaterMontant(donnees.depensesCentimes)}
              </span>
              <span className="finances-boite-detail">
                Achats et charges du cabinet — cliquer pour la liste
              </span>
            </button>
          </div>

          {/* ── FILTRES DE PÉRIODE — groupe segmenté ─────────────────────────── */}
          <div className="finances-outils">
            <div className="finances-groupe-periode" role="group" aria-label="Période">
              {OPTIONS_PERIODE.filter((option) => option.valeur !== 'personnalisee').map((option) => (
                <button
                  key={option.valeur}
                  type="button"
                  aria-pressed={periode === option.valeur}
                  onClick={() => setPeriode(option.valeur)}
                >
                  {option.libelle}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={periode === 'personnalisee'}
                onClick={() => setPeriode('personnalisee')}
              >
                Personnalisé
              </button>
            </div>

            {periode === 'personnalisee' ? (
              <form onSubmit={appliquerPlage} className="finances-filtres-dates">
                <input
                  aria-label="Du"
                  type="date"
                  value={du}
                  onChange={(evenement) => setDu(evenement.target.value)}
                />
                <input
                  aria-label="Au"
                  type="date"
                  value={au}
                  onChange={(evenement) => setAu(evenement.target.value)}
                />
                <button type="submit" className="finances-bouton finances-bouton-principal">
                  Appliquer
                </button>
              </form>
            ) : null}
          </div>

          {/* ── Listes détaillées (une seule ouverte à la fois) ─────────────── */}
          {boiteOuverte === 'paiements' ? (
            <ListePaiementsRecus params={params.toString()} />
          ) : null}
          {boiteOuverte === 'dettes' ? <ListeDettes /> : null}
          {boiteOuverte === 'depenses' ? (
            <ListeDepenses
              debut={periodeEffective === 'personnalisee' ? plageValidee.du : undefined}
              fin={periodeEffective === 'personnalisee' ? plageValidee.au : undefined}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
//  BOÎTE VERTE — liste des paiements reçus (paiements partiels : ligne à ligne)
// -----------------------------------------------------------------------------

interface LignePaiement {
  id: string
  patient: string
  montantCentimes: number
  date: string
  description: string | null
}

function ListePaiementsRecus({ params }: { params: string }): React.JSX.Element {
  const [page, setPage] = useState(1)
  const { donnees, chargement, erreur, recharger } = useRequeteFinanciere<{
    elements: LignePaiement[]
    total: number
    totalCentimes: number
    page: number
    pages: number
  }>(`/api/finances/details?boite=paiements&page=${page}&taille=20&${params}`)

  return (
    <section className="finances-panneau finances-panneau-recu" aria-label="Paiements reçus">
      <h2>Paiements reçus — détail</h2>
      {chargement && !donnees ? <p>Chargement…</p> : null}
      {erreur ? (
        <div role="alert" className="finances-erreur">
          <p>{erreur}</p>
          <button type="button" onClick={recharger}>Réessayer</button>
        </div>
      ) : null}
      {donnees && donnees.elements.length === 0 ? <p>Aucun paiement reçu sur cette période.</p> : null}
      {donnees && donnees.elements.length > 0 ? (
        <>
          <table className="finances-tableau">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col">Montant</th>
              </tr>
            </thead>
            <tbody>
              {donnees.elements.map((ligne) => (
                <tr key={ligne.id}>
                  <td>{ligne.patient}</td>
                  <td>{formaterDate(ligne.date)}</td>
                  <td>{ligne.description ?? '—'}</td>
                  <td className="finances-nombre finances-couleur-recu">
                    {formaterMontant(ligne.montantCentimes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={donnees.page} pages={donnees.pages} total={donnees.total} onPage={setPage} />
        </>
      ) : null}
    </section>
  )
}

// -----------------------------------------------------------------------------
//  BOÎTE ORANGE — liste des dettes des patients
// -----------------------------------------------------------------------------

interface LigneDette {
  patientId: string
  patient: string
  telephone: string
  resteAPayerCentimes: number
  dernierPaiement: string | null
}

function ListeDettes(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const { donnees, chargement, erreur, recharger } = useRequeteFinanciere<{
    elements: LigneDette[]
    total: number
    totalCentimes: number
    page: number
    pages: number
  }>(`/api/finances/details?boite=dettes&page=${page}&taille=20`)

  return (
    <section className="finances-panneau finances-panneau-dette" aria-label="Dettes des patients">
      <h2>Patients qui doivent encore de l&rsquo;argent</h2>
      <p className="finances-mention">
        Solde global du cabinet : montant facturé (traitements non annulés) moins
        paiements encaissés. Ce solde ne dépend pas de la période choisie — un
        patient qui doit de l&rsquo;argent aujourd&rsquo;hui le doit toujours jusqu&rsquo;à
        règlement. Ce n&rsquo;est PAS de l&rsquo;argent reçu.
      </p>
      {chargement && !donnees ? <p>Chargement…</p> : null}
      {erreur ? (
        <div role="alert" className="finances-erreur">
          <p>{erreur}</p>
          <button type="button" onClick={recharger}>Réessayer</button>
        </div>
      ) : null}
      {donnees && donnees.elements.length === 0 ? <p>Aucune dette patient en cours.</p> : null}
      {donnees && donnees.elements.length > 0 ? (
        <>
          <table className="finances-tableau">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Téléphone</th>
                <th scope="col">Dernier paiement</th>
                <th scope="col">Reste à payer</th>
              </tr>
            </thead>
            <tbody>
              {donnees.elements.map((ligne) => (
                <tr key={ligne.patientId}>
                  <td>{ligne.patient}</td>
                  <td>{ligne.telephone}</td>
                  <td>{ligne.dernierPaiement ? formaterDate(ligne.dernierPaiement) : '—'}</td>
                  <td className="finances-nombre finances-couleur-dette">
                    {formaterMontant(ligne.resteAPayerCentimes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={donnees.page} pages={donnees.pages} total={donnees.total} onPage={setPage} />
        </>
      ) : null}
    </section>
  )
}

// -----------------------------------------------------------------------------
//  BOÎTE ROUGE — liste des dépenses de la clinique (même API, période passée)
// -----------------------------------------------------------------------------

interface LigneDepense {
  id: string
  montantCentimes: number
  date: string
  categorie: string
  description: string | null
  notes: string | null
}

function ListeDepenses({
  debut,
  fin,
}: {
  debut?: string
  fin?: string
}): React.JSX.Element {
  const [page, setPage] = useState(1)
  const paramsRequete = new URLSearchParams({ page: String(page), taille: '20' })
  if (debut && fin) {
    paramsRequete.set('du', debut)
    paramsRequete.set('au', fin)
  }
  const { donnees, chargement, erreur, recharger } = useRequeteFinanciere<{
    elements: LigneDepense[]
    total: number
    page: number
    pages: number
  }>(`/api/finances/expenses?${paramsRequete.toString()}`)

  return (
    <section className="finances-panneau finances-panneau-depense" aria-label="Dépenses de la clinique">
      <h2>Dépenses de la clinique — détail</h2>
      {chargement && !donnees ? <p>Chargement…</p> : null}
      {erreur ? (
        <div role="alert" className="finances-erreur">
          <p>{erreur}</p>
          <button type="button" onClick={recharger}>Réessayer</button>
        </div>
      ) : null}
      {donnees && donnees.elements.length === 0 ? <p>Aucune dépense sur cette période.</p> : null}
      {donnees && donnees.elements.length > 0 ? (
        <>
          <table className="finances-tableau">
            <thead>
              <tr>
                <th scope="col">Nom de la dépense</th>
                <th scope="col">Date</th>
                <th scope="col">Montant</th>
              </tr>
            </thead>
            <tbody>
              {donnees.elements.map((ligne) => (
                <tr key={ligne.id}>
                  <td>{ligne.description ?? ligne.notes ?? '—'}</td>
                  <td>{formaterDate(ligne.date)}</td>
                  <td className="finances-nombre finances-couleur-depense">
                    {formaterMontant(ligne.montantCentimes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={donnees.page} pages={donnees.pages} total={donnees.total} onPage={setPage} />
        </>
      ) : null}
    </section>
  )
}

// -----------------------------------------------------------------------------
//  FORMULAIRE « + » — dépense de la clinique (matériel, fournitures, maintenance)
// -----------------------------------------------------------------------------

function FormulaireDepenseClinique({
  existant,
  onFermer,
  onSucces,
}: {
  existant?: {
    id: string
    montantCentimes: number
    categorie: string
    description: string | null
    notes: string | null
    date: string
  }
  onFermer: () => void
  onSucces?: () => void
}): React.JSX.Element {
  const [montant, setMontant] = useState(
    existant ? String(Math.round(existant.montantCentimes) / 100) : '',
  )
  const [description, setDescription] = useState(existant?.description ?? '')
  const [date, setDate] = useState(
    existant ? existant.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  )
  const [note, setNote] = useState(existant?.notes ?? '')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const cleAntiDoublon = useMemo(() => genererCleAntiDoublon(), [])

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreur(null)

    const montantEnCentimes = parseMontantEnCentimes(montant)
    if (montantEnCentimes === null || montantEnCentimes <= 0) {
      setErreur('Le montant doit être supérieur à zéro.')
      return
    }
    if (!description.trim()) {
      setErreur('Le nom de la dépense est obligatoire.')
      return
    }

    setEnCours(true)
    try {
      await requeteFinanciere('/api/finances/expenses', {
        methode: 'POST',
        corps: {
          montantCentimes: montantEnCentimes,
          /*
           * PAS DE CHAMP CATÉGORIE (§finances-v5) : le schéma API exige une
           * valeur non vide — on transmet une constante, jamais montrée à
           * l'écran. La description libre du médecin porte tout le sens.
           */
          categorie: existant?.categorie ?? 'AUTRE',
          description: description.trim(),
          // Le schéma API n'accepte PAS `null` pour ce champ : on omet la clé
          // quand la note est vide, exactement comme les autres formulaires.
          ...(note.trim() ? { notes: note.trim() } : {}),
          date: new Date(`${date}T12:00:00`).toISOString(),
          idempotencyKey: cleAntiDoublon,
        },
      })
      onSucces?.()
      onFermer()
    } catch (cause) {
      setErreur(messageErreur(cause))
      setEnCours(false)
    }
  }

  return (
    /*
     * AUTOCOMPLETE="off" SUR LE FORMULAIRE ENTIER : Chrome l'ignore parfois
     * champ par champ quand un gestionnaire de mots de passe s'en mêle — le
     * poser sur <form> ET sur chaque champ maximise les chances que les
     * suggestions soient coupées partout.
     */
    <form onSubmit={soumettre} className="finances-carte" noValidate autoComplete="off">
      <h2>Nouvelle dépense de la clinique</h2>
      <p className="finances-mention">
        Achat de matériel, fournitures, maintenance, autre charge du cabinet.
        Cette dépense n&rsquo;affecte JAMAIS les paiements des patients ni leurs dettes.
      </p>

      {erreur ? <div role="alert" className="finances-erreur">{erreur}</div> : null}

      <div className="finances-champ">
        <label htmlFor="dep-nom">Nom de la dépense</label>
        <input
          id="dep-nom"
          required
          placeholder="Ex. Achat d&rsquo;une machine dentaire"
          value={description}
          onChange={(evenement) => setDescription(evenement.target.value)}
          disabled={enCours}
          /*
           * AUCUNE SUGGESTION (§finances-v8) : `autocomplete="off"` coupe le
           * remplissage automatique du navigateur ; `autoCorrect`/`autoCapitalize`
           * évitent les substitutions mobiles ; `enterKeyHint="enter"` retire la
           * touche « recherche » qui déclenche des predictions sur certains
           * navigateurs ; `spellCheck={false}` supprime le soulignement.
           */
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="enter"
          name="dep-nom-libre"
        />
      </div>

      <div className="finances-champ">
        <label htmlFor="dep-montant">Montant (DA)</label>
        <input
          id="dep-montant"
          inputMode="decimal"
          required
          value={montant}
          onChange={(evenement) => setMontant(evenement.target.value)}
          disabled={enCours}
          /* Aucune suggestion ni autofill : saisie numérique libre. La
             validation serveur (parseMontantEnCentimes) reste inchangée. */
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="enter"
          name="dep-montant-libre"
        />
      </div>

      <div className="finances-champ">
        <label htmlFor="dep-date">Date</label>
        <input
          id="dep-date"
          type="date"
          required
          value={date}
          onChange={(evenement) => setDate(evenement.target.value)}
          disabled={enCours}
        />
      </div>

      <div className="finances-champ">
        <label htmlFor="dep-note">Note (facultatif)</label>
        <textarea
          id="dep-note"
          rows={2}
          value={note}
          onChange={(evenement) => setNote(evenement.target.value)}
          disabled={enCours}
        />
      </div>

      <div className="finances-actions">
        <button type="button" onClick={onFermer} disabled={enCours} className="finances-bouton">
          Annuler
        </button>
        <button type="submit" disabled={enCours} className="finances-bouton finances-bouton-principal">
          {enCours ? 'Enregistrement…' : 'Enregistrer la dépense'}
        </button>
      </div>
    </form>
  )
}

// -----------------------------------------------------------------------------
//  COMMUNS
// -----------------------------------------------------------------------------

function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number
  pages: number
  total: number
  onPage: (suivante: number) => void
}): React.JSX.Element {
  return (
    <div className="finances-pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Précédent
      </button>
      <span>
        Page {page} sur {pages} — {total} ligne(s)
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Suivant
      </button>
    </div>
  )
}

function formaterDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
