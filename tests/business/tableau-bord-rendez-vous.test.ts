import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * =============================================================================
 *  REGRESSION — ANCIENS / NOUVEAUX RENDEZ-VOUS (§25)
 * =============================================================================
 *
 *  Le tableau de bord doit distinguer, parmi les rendez-vous DU JOUR :
 *    - les ANCIENS : patients ayant deja consulte au cabinet ;
 *    - les NOUVEAUX : patients dont le rendez-vous du jour est la PREMIERE
 *      visite (aucun rendez-vous anterieur).
 *
 *  Ce qui est verrouille ici :
 *    - la comparaison porte sur les rendez-vous STRICTEMENT ANTERIEURS a
 *      aujourd'hui (jamais sur « les autres rendez-vous du jour ») ;
 *    - le regroupement est fait par la BASE (`distinct`) et non en memoire ;
 *    - un patient sans historique est « nouveau », un patient avec historique
 *      est « ancien », quelle que soit la date de cet historique ;
 *    - les deux compteurs sont derives des memes donnees que la liste.
 *
 *  Le client Prisma est remplace par un double : la base n'est pas requise.
 */

interface RdvJour {
  id: string
  datePaiement?: never
  dateDebut: Date
  dateFin: Date
  statut: string
  motif: string | null
  patient: { id: string; nom: string; prenom: string; telephone: string }
}

/** Rendez-vous du jour renvoyes par `appointment.findMany` (1er appel). */
let rdvDuJour: RdvJour[] = []
/** Visites sans rendez-vous renvoyees par `appointment.findMany` (2e appel). */
let visitesSansRdv: RdvJour[] = []
/** Patients deja connus renvoyes par le 3e appel (`distinct`). */
let patientsConnus: Array<{ patientId: string }> = []
let requetes: Array<{ where?: unknown; distinct?: unknown }> = []

const fakePrisma = {
  appointment: {
    findMany: vi.fn(async (args: { where?: Record<string, unknown>; distinct?: unknown }) => {
      requetes.push(args)
      const filtre = args.where ?? {}
      // 1. Historique des patients deja connus (2e passe, filtre par patientId).
      if (filtre.patientId) return patientsConnus
      // 2. Visites spontanees du jour (filtre positif sur le marqueur).
      const motif = filtre.motif as { startsWith?: string } | undefined
      if (motif?.startsWith) return visitesSansRdv
      // 3. Rendez-vous planifies du jour.
      return rdvDuJour
    }),
    count: vi.fn(async () => rdvDuJour.length),
  },
  treatment: { count: vi.fn(async () => 0) },
  patient: { count: vi.fn(async () => 0) },
  payment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
  $queryRaw: vi.fn(async () => []),
}

vi.mock('@backend/database/prisma', () => ({ prisma: fakePrisma }))
vi.mock('@backend/services/payments.service', async () => ({
  totalEncaisse: vi.fn(async () => 0),
  totalRestantARecevoir: vi.fn(async () => 0),
  revenusParMois: vi.fn(async () => []),
  revenusParAnnee: vi.fn(async () => []),
  revenusParMethode: vi.fn(async () => []),
}))

const { donneesTableauBord } = await import('@backend/services/reports.service')

function rdv(id: string, patientId: string, heure: number): RdvJour {
  const auj = new Date()
  return {
    id,
    dateDebut: new Date(auj.getFullYear(), auj.getMonth(), auj.getDate(), heure, 0),
    dateFin: new Date(auj.getFullYear(), auj.getMonth(), auj.getDate(), heure, 30),
    statut: 'PLANIFIE',
    motif: null,
    patient: { id: patientId, nom: 'Nom', prenom: 'Prenom', telephone: '0550000000' },
  }
}

beforeEach(() => {
  rdvDuJour = []
  visitesSansRdv = []
  patientsConnus = []
  requetes = []
  fakePrisma.appointment.findMany.mockClear()
})

describe('Tableau de bord — anciens / nouveaux rendez-vous', () => {
  it('classe le patient SANS historique comme nouveau', async () => {
    rdvDuJour = [rdv('a', 'p-nouveau', 9)]
    patientsConnus = []

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousNouveaux).toBe(1)
    expect(donnees.rendezVousAnciens).toBe(0)
    expect(donnees.rendezVousDuJour[0]?.patientConnu).toBe(false)
  })

  it('classe le patient AVEC historique comme ancien', async () => {
    rdvDuJour = [rdv('a', 'p-connu', 9)]
    patientsConnus = [{ patientId: 'p-connu' }]

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousAnciens).toBe(1)
    expect(donnees.rendezVousNouveaux).toBe(0)
    expect(donnees.rendezVousDuJour[0]?.patientConnu).toBe(true)
  })

  it('compte separement les deux categories sur une journee mixte', async () => {
    rdvDuJour = [rdv('a', 'p1', 9), rdv('b', 'p2', 10), rdv('c', 'p3', 11)]
    patientsConnus = [{ patientId: 'p1' }, { patientId: 'p3' }]

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousAnciens).toBe(2)
    expect(donnees.rendezVousNouveaux).toBe(1)
    expect(donnees.rendezVousDuJour.map((r) => r.patientConnu)).toEqual([true, false, true])
  })

  it('la comparaison porte sur les rendez-vous ANTERIEURS a aujourd’hui', async () => {
    rdvDuJour = [rdv('a', 'p1', 9)]
    patientsConnus = [{ patientId: 'p1' }]

    await donneesTableauBord()

    const rechercheHistorique = requetes.find((r) => r.distinct !== undefined)
    expect(rechercheHistorique).toBeDefined()

    const where = rechercheHistorique?.where as {
      dateDebut?: { lt?: Date }
      patientId?: { in?: string[] }
    }
    expect(where.dateDebut?.lt).toBeInstanceOf(Date)

    // La borne est le DEBUT de la journee courante : un rendez-vous d'hier
    // compte, un rendez-vous de ce matin ne compte pas comme « anterieur ».
    const borne = where.dateDebut?.lt as Date
    const debutJour = new Date()
    debutJour.setHours(0, 0, 0, 0)
    expect(borne.getTime()).toBe(debutJour.getTime())

    // Seuls les patients du jour sont interroges.
    expect(where.patientId?.in).toEqual(['p1'])
  })

  it('le regroupement est fait par la BASE (distinct), pas en memoire', async () => {
    rdvDuJour = [rdv('a', 'p1', 9), rdv('b', 'p1', 14)]
    patientsConnus = [{ patientId: 'p1' }]

    await donneesTableauBord()

    const rechercheHistorique = requetes.find((r) => r.distinct !== undefined)
    expect(rechercheHistorique?.distinct).toEqual(['patientId'])
  })

  it('un patient venu deux fois le meme jour reste « ancien » les deux fois', async () => {
    // Le premier rendez-vous du jour ne rend PAS le second « ancien » par
    // lui-meme : seule la presence d'un rendez-vous anterieur compte. Ici la
    // base indique que le patient est connu (visite precedente reelle).
    rdvDuJour = [rdv('a', 'p1', 9), rdv('b', 'p1', 14)]
    patientsConnus = [{ patientId: 'p1' }]

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousAnciens).toBe(2)
    expect(donnees.rendezVousNouveaux).toBe(0)
  })

  it('n’interroge PAS la base quand aucun rendez-vous aujourd’hui', async () => {
    rdvDuJour = []
    visitesSansRdv = []
    fakePrisma.appointment.findMany.mockClear()

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousAnciens).toBe(0)
    expect(donnees.rendezVousNouveaux).toBe(0)
    // Aucun rendez-vous ni visite : aucune recherche d'historique n'est lancee
    // pour une journee vide.
    const rechercheHistorique = requetes.filter((r) => r.distinct !== undefined)
    expect(rechercheHistorique).toHaveLength(0)
  })

  it('les compteurs sont coherents avec la liste renvoyee', async () => {
    rdvDuJour = [rdv('a', 'p1', 9), rdv('b', 'p2', 10), rdv('c', 'p3', 11), rdv('d', 'p4', 15)]
    patientsConnus = [{ patientId: 'p2' }]

    const donnees = await donneesTableauBord()

    const anciens = donnees.rendezVousDuJour.filter((r) => r.patientConnu).length
    const nouveaux = donnees.rendezVousDuJour.filter((r) => !r.patientConnu).length
    expect(donnees.rendezVousAnciens).toBe(anciens)
    expect(donnees.rendezVousNouveaux).toBe(nouveaux)
    expect(anciens + nouveaux).toBe(donnees.rendezVousDuJour.length)
  })
})/**
 * =============================================================================
 *  REGRESSION — PATIENTS SANS RENDEZ-VOUS (§25)
 * =============================================================================
 *
 *  Le tableau de bord doit separer deux populations DISJOINTES :
 *    - « Rendez-vous du jour »        : patients attendus sur un creneau ;
 *    - « Patients sans rendez-vous »  : patients venus spontanement.
 *
 *  Ce qui est verrouille ici, conformement a la specification :
 *    - la distinction repose sur le MARQUEUR de motif, JAMAIS sur l'anciennete
 *      du patient : un patient connu peut arriver sans rendez-vous (cas 3), un
 *      patient nouveau peut avoir un rendez-vous planifie (cas 4) ;
 *    - les deux listes sont filtrees EN BASE (SQL), pas en memoire ;
 *    - un rendez-vous planifie n'apparait JAMAIS dans la liste des visites
 *      spontanees, et inversement ;
 *    - le marqueur technique est retire du motif affiche.
 */

function visite(id: string, patientId: string, heure: number, consultation: string): RdvJour {
  const auj = new Date()
  return {
    id,
    dateDebut: new Date(auj.getFullYear(), auj.getMonth(), auj.getDate(), heure, 0),
    dateFin: new Date(auj.getFullYear(), auj.getMonth(), auj.getDate(), heure, 30),
    statut: 'TERMINE',
    // Motif tel que STOCKE par le service : marqueur + motif de consultation.
    motif: `Sans rendez-vous — ${consultation}`,
    patient: { id: patientId, nom: 'Nom', prenom: 'Prenom', telephone: '0550000000' },
  }
}

describe('Tableau de bord — patients sans rendez-vous', () => {
  it('separe un rendez-vous planifie d’une visite spontanee', async () => {
    rdvDuJour = [rdv('a', 'p1', 9)]
    visitesSansRdv = [visite('v1', 'p2', 10, 'Extraction dentaire')]

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousDuJour.map((r) => r.id)).toEqual(['a'])
    expect(donnees.patientsSansRendezVous.map((v) => v.id)).toEqual(['v1'])
  })

  it('CAS 4 — un patient NOUVEAU avec rendez-vous reste « planifie »', async () => {
    // Aucun historique : le patient est nouveau...
    patientsConnus = []
    rdvDuJour = [rdv('a', 'p-nouveau', 9)]
    visitesSansRdv = []

    const donnees = await donneesTableauBord()

    // ...et il figure bien dans les rendez-vous du jour, pas dans les visites.
    expect(donnees.rendezVousDuJour).toHaveLength(1)
    expect(donnees.rendezVousNouveaux).toBe(1)
    expect(donnees.patientsSansRendezVous).toHaveLength(0)
  })

  it('CAS 3 — un patient EXISTANT sans rendez-vous est classe « sans rendez-vous »', async () => {
    // Le patient a deja consulte : il est connu du cabinet.
    patientsConnus = [{ patientId: 'p-connu' }]
    rdvDuJour = []
    visitesSansRdv = [visite('v1', 'p-connu', 11, 'Premiere consultation')]

    const donnees = await donneesTableauBord()

    expect(donnees.patientsSansRendezVous).toHaveLength(1)
    expect(donnees.patientsSansRendezVous[0]?.patientConnu).toBe(true)
    // Et il n'est evidemment pas compte comme patient attendu.
    expect(donnees.rendezVousDuJour).toHaveLength(0)
  })

  it('retire le marqueur technique du motif affiche', async () => {
    rdvDuJour = []
    visitesSansRdv = [visite('v1', 'p1', 10, 'Extraction dentaire')]

    const donnees = await donneesTableauBord()

    // L'interface affiche le motif de consultation SEUL.
    expect(donnees.patientsSansRendezVous[0]?.motifConsultation).toBe('Extraction dentaire')
  })

  it('filtre les deux populations EN BASE (SQL), pas en memoire', async () => {
    rdvDuJour = [rdv('a', 'p1', 9)]
    visitesSansRdv = [visite('v1', 'p2', 10, 'Detartrage')]

    await donneesTableauBord()

    /*
     * Requete des rendez-vous PLANIFIES : le marqueur doit etre exclu, mais
     * SANS ecrire `NOT: { motif: … }`.
     *
     * Cette forme etait un piege : Prisma la traduit en
     *   NOT (motif LIKE 'Sans rendez-vous%')
     * et, en SQL, `NOT NULL` vaut `NULL` (ni vrai, ni faux). La ligne est alors
     * ELIMINEE au lieu d'etre conservee. Or le motif d'un rendez-vous planifie
     * est NULL dans le cas normal : TOUS les rendez-vous du jour disparaissaient
     * du tableau de bord. Le filtre doit donc accepter explicitement le NULL.
     */
    const requetePlanifies = requetes.find((r) => {
      const where = r.where as { AND?: unknown } | undefined
      return Array.isArray(where?.AND)
    })
    expect(requetePlanifies).toBeDefined()

    // Le motif NULL est explicitement accepte…
    const filtre = (requetePlanifies?.where as { AND: unknown[] }).AND[0] as {
      OR: Array<{ motif?: { not?: { startsWith?: string } } | null }>
    }
    expect(filtre.OR).toContainEqual({ motif: null })
    // …et le marqueur reste exclu.
    expect(filtre.OR).toContainEqual({
      motif: { not: { startsWith: 'Sans rendez-vous' } },
    })

    // Requete des visites spontanees : filtre POSITIF sur le marqueur.
    const requeteVisites = requetes.find((r) => {
      const where = r.where as { motif?: { startsWith?: string } } | undefined
      return where?.motif?.startsWith !== undefined
    })
    expect(requeteVisites).toBeDefined()
    expect((requeteVisites?.where as { motif: { startsWith: string } }).motif.startsWith).toBe(
      'Sans rendez-vous',
    )
  })

  it('conserve les rendez-vous planifies dont le motif est NULL', async () => {
    // Regression : un rendez-vous planifie n'a pas de marqueur, donc `motif` est
    // NULL. Il doit figurer dans la liste, et surtout pas disparaitre du total.
    rdvDuJour = [{ ...rdv('a', 'p1', 9), motif: null }]
    visitesSansRdv = []

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousDuJour).toHaveLength(1)
    expect(donnees.rendezVousAnciens + donnees.rendezVousNouveaux).toBe(1)
  })

  it('un patient venu sans rendez-vous compte comme CONNU a sa seconde visite', async () => {
    // Historique : seule la visite spontanee d'hier existe (pas de rendez-vous).
    // `patientsConnus` provient de TOUS les rendez-vous anterieurs, quelle que
    // soit leur nature : une visite spontanee passee rend donc le patient connu.
    patientsConnus = [{ patientId: 'p1' }]
    rdvDuJour = []
    visitesSansRdv = [visite('v2', 'p1', 14, 'Soin de carie')]

    const donnees = await donneesTableauBord()

    expect(donnees.patientsSansRendezVous[0]?.patientConnu).toBe(true)
  })

  it('journee vide : listes vides, aucune erreur', async () => {
    rdvDuJour = []
    visitesSansRdv = []

    const donnees = await donneesTableauBord()

    expect(donnees.rendezVousDuJour).toEqual([])
    expect(donnees.patientsSansRendezVous).toEqual([])
  })
})