import { describe, expect, it } from 'vitest'

import { TYPES_TRAITEMENT_RENDEZ_VOUS } from '@backend/domain/constants'
import { premierCreneauDisponible } from '@backend/services/appointments.service'
import { rendezVousFormCreationSchema } from '@backend/validation/schemas'

const base = {
  patientId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  date: '2026-09-28',
  typeTraitement: TYPES_TRAITEMENT_RENDEZ_VOUS[0],
  totalCentimes: 2_000_000,
  payeCentimes: 500_000,
  notes: 'Controle',
  idempotencyKey: 'rdv-cle-test-1234',
}

describe('Creation de rendez-vous depuis le formulaire', () => {
  it('accepte un patient existant, un traitement et des montants centimes valides', () => {
    expect(rendezVousFormCreationSchema.parse(base)).toMatchObject({
      patientId: base.patientId,
      date: base.date,
      typeTraitement: base.typeTraitement,
      totalCentimes: 2_000_000,
      payeCentimes: 500_000,
    })
  })

  it('conserve exactement les quatre choix de traitement arabes', () => {
    expect(TYPES_TRAITEMENT_RENDEZ_VOUS).toEqual([
      'تركيب الأسنان',
      'تقويم وتنظيف الأسنان',
      'جراحة الأسنان واللثة',
      'علاج تسوس وعصب الأسنان بالأشعة',
    ])
  })

  it('refuse un montant payé supérieur au total', () => {
    expect(() => rendezVousFormCreationSchema.parse({ ...base, payeCentimes: 2_000_001 })).toThrow()
  })

  it('refuse les montants négatifs', () => {
    expect(() => rendezVousFormCreationSchema.parse({ ...base, totalCentimes: -1 })).toThrow()
    expect(() => rendezVousFormCreationSchema.parse({ ...base, payeCentimes: -1 })).toThrow()
  })

  it('refuse les dates calendaires invalides', () => {
    expect(() => rendezVousFormCreationSchema.parse({ ...base, date: '2026-02-31' })).toThrow()
  })
})

describe('Allocation interne du creneau pour un rendez-vous sans heure saisie', () => {
  it('choisit le premier creneau disponible de 30 minutes', () => {
    const slot = premierCreneauDisponible('2030-04-15', [])
    expect(slot.dateDebut.getHours()).toBe(9)
    expect(slot.dateDebut.getMinutes()).toBe(0)
    expect(slot.dateFin.getTime() - slot.dateDebut.getTime()).toBe(30 * 60_000)
  })

  it('saute les creneaux occupes et ne chevauche pas les rendez-vous existants', () => {
    const jour = new Date(2030, 3, 15)
    const neuf = new Date(jour)
    neuf.setHours(9, 0, 0, 0)
    const neufTrente = new Date(jour)
    neufTrente.setHours(9, 30, 0, 0)
    const slot = premierCreneauDisponible('2030-04-15', [
      { dateDebut: neuf, dateFin: neufTrente },
    ])
    expect(slot.dateDebut.getHours()).toBe(9)
    expect(slot.dateDebut.getMinutes()).toBe(30)
  })
})
