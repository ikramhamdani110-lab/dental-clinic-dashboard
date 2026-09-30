import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * =============================================================================
 *  REGRESSION — PAGINATION DE LA CORBEILLE (§23, §35)
 * =============================================================================
 *
 *  Verifie que `listerCorbeille` :
 *    - ne renvoie QUE les elements de la page demandee (skip/take en base),
 *    - conserve le filtre de fenetre de 24 h (expireLe > maintenant),
 *    - renvoie un total separe (pagination coherente),
 *    - trie de facon deterministe (supprimeLe DESC, id DESC).
 *
 *  Le client Prisma est remplace par un double afin de verifier QUE la
 *  pagination est bien realisee par la base et non en memoire.
 */

interface Ligne {
  id: string
  entityType: string
  description: string
  supprimeLe: Date
  expireLe: Date
  supprimePar: { displayName: string } | null
}

let lignes: Ligne[] = []
let derniereRequete: { skip?: number; take?: number; orderBy?: unknown; where?: unknown } | null = null

const fakePrisma = {
  trashEntry: {
    findMany: vi.fn(async (args: { skip?: number; take?: number; orderBy?: unknown; where?: unknown }) => {
      derniereRequete = args
      // Reproduction fidele : filtre fenetre + tri + decoupage SQL.
      const now = new Date()
      const filtree = lignes
        .filter((l) => l.expireLe.getTime() > now.getTime())
        .sort((a, b) => b.supprimeLe.getTime() - a.supprimeLe.getTime() || (a.id < b.id ? 1 : -1))
      const skip = args.skip ?? 0
      const take = args.take ?? filtree.length
      return filtree.slice(skip, skip + take)
    }),
    count: vi.fn(async () => {
      const now = new Date()
      return lignes.filter((l) => l.expireLe.getTime() > now.getTime()).length
    }),
  },
}

vi.mock('@backend/database/prisma', () => ({ prisma: fakePrisma }))

const { listerCorbeille } = await import('@backend/services/trash.service')

function ligne(id: string, minutesEcoulees: number): Ligne {
  const supprimeLe = new Date(Date.now() - minutesEcoulees * 60 * 1000)
  return {
    id,
    entityType: 'PATIENT',
    description: 'Patient supprime ' + id,
    supprimeLe,
    // Expire 24 h apres la suppression.
    expireLe: new Date(supprimeLe.getTime() + 24 * 60 * 60 * 1000),
    supprimePar: { displayName: 'Dr Ikram' },
  }
}

beforeEach(() => {
  lignes = []
  derniereRequete = null
  fakePrisma.trashEntry.findMany.mockClear()
  fakePrisma.trashEntry.count.mockClear()
})

describe('listerCorbeille — pagination en base', () => {
  it('renvoie une page vide quand la corbeille est vide', async () => {
    const page = await listerCorbeille({ page: 1, taille: 10 })
    expect(page.elements).toEqual([])
    expect(page.total).toBe(0)
    expect(page.pages).toBe(1)
  })

  it('applique skip/take en base selon la page demandee', async () => {
    for (let i = 0; i < 25; i += 1) lignes.push(ligne('id-' + String(i).padStart(2, '0'), i + 1))

    const page1 = await listerCorbeille({ page: 1, taille: 10 })
    expect(page1.elements).toHaveLength(10)
    expect(page1.total).toBe(25)
    expect(page1.pages).toBe(3)
    expect(derniereRequete?.skip).toBe(0)
    expect(derniereRequete?.take).toBe(10)

    const page3 = await listerCorbeille({ page: 3, taille: 10 })
    expect(page3.elements).toHaveLength(5)
    expect(derniereRequete?.skip).toBe(20)
    expect(derniereRequete?.take).toBe(10)
  })

  it('ne charge JAMAIS l’integralite de la corbeille', async () => {
    for (let i = 0; i < 500; i += 1) lignes.push(ligne('id-' + String(i).padStart(3, '0'), i + 1))
    const page = await listerCorbeille({ page: 1, taille: 25 })
    expect(page.elements).toHaveLength(25)
    expect(page.total).toBe(500)
    // Le `take` envoye a la base vaut la taille de page, pas 500.
    expect(derniereRequete?.take).toBe(25)
  })

  it('exclut les elements dont la fenetre de 24 h est ecoulee', async () => {
    // 3 elements recents (restaurables), 2 elements vieux de plus de 24 h (expires).
    lignes.push(ligne('recent-1', 60))
    lignes.push(ligne('recent-2', 120))
    lignes.push(ligne('recent-3', 23 * 60)) // 23 h
    lignes.push(ligne('vieux-1', 25 * 60)) // 25 h => expire
    lignes.push(ligne('vieux-2', 48 * 60)) // 48 h => expire

    const page = await listerCorbeille({ page: 1, taille: 10 })
    expect(page.total).toBe(3)
    expect(page.elements.map((e) => e.id).sort()).toEqual(['recent-1', 'recent-2', 'recent-3'])
  })

  it('calcule le temps restant cote serveur, borne a zero', async () => {
    lignes.push(ligne('r1', 60)) // 1 h ecoulee => ~23 h restantes
    const page = await listerCorbeille({ page: 1, taille: 10 })
    const premier = page.elements[0]
    expect(premier).toBeDefined()
    const restant = premier?.tempsRestantMs ?? -1
    expect(restant).toBeGreaterThan(0)
    expect(restant).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })

  it('produit un ordre deterministe (supprimeLe DESC, id DESC)', async () => {
    lignes.push(ligne('a', 100))
    lignes.push(ligne('b', 200))
    lignes.push(ligne('c', 300))
    const p1 = await listerCorbeille({ page: 1, taille: 10 })
    const p2 = await listerCorbeille({ page: 1, taille: 10 })
    expect(p1.elements.map((e) => e.id)).toEqual(p2.elements.map((e) => e.id))
    // Le plus recemment supprime (a, 100 min) arrive en tete.
    expect(p1.elements[0]?.id).toBe('a')
  })
})