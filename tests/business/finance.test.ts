import { describe, expect, it } from 'vitest'

import {
  calculerSolde,
  centimesVersDinars,
  formaterMontant,
  parseMontantEnCentimes,
  verifierAbsenceDepassement,
} from '@backend/domain/finance'

/**
 * =============================================================================
 *  CALCULS FINANCIERS (§12, §16, §17, §44)
 * =============================================================================
 *
 *  Ces tests verifient les regles metier les plus critiques du systeme : un
 *  solde faux, dans un cabinet dentaire, c'est un litige avec un patient.
 *  Ils s'executent sans base de donnees : les fonctions testees sont pures.
 */

describe('Conversion des montants (dinars <-> centimes)', () => {
  it('convertit une saisie entiere en centimes', () => {
    expect(parseMontantEnCentimes('15000')).toBe(1_500_000)
  })

  it('accepte les espaces de separation', () => {
    expect(parseMontantEnCentimes('15 000')).toBe(1_500_000)
  })

  it('accepte la virgule decimale francaise', () => {
    expect(parseMontantEnCentimes('1500,50')).toBe(150_050)
  })

  it('accepte le point decimal', () => {
    expect(parseMontantEnCentimes('1500.50')).toBe(150_050)
  })

  it('refuse une saisie non numerique', () => {
    expect(parseMontantEnCentimes('abc')).toBeNull()
  })

  it('refuse plus de deux decimales', () => {
    expect(parseMontantEnCentimes('100,123')).toBeNull()
  })

  it('refuse un montant negatif', () => {
    expect(parseMontantEnCentimes('-100')).toBeNull()
  })

  it('convertit des centimes en dinars pour le formulaire', () => {
    expect(centimesVersDinars(1_500_000)).toBe(15_000)
    expect(centimesVersDinars(150_050)).toBe(1500.5)
  })
})

describe('Formatage des montants', () => {
  /**
   * Le formatage francais utilise une espace insecable etroite (U+202F) comme
   * separateur de milliers. On normalise avant comparaison pour que le test
   * verifie le MONTANT, sans dependre du caractere d'espacement exact, qui varie
   * selon la version d'ICU.
   */
  const normaliser = (valeur: string): string => valeur.replace(/\u202f|\u00a0|\s/g, ' ')

  it('affiche un montant rond sans decimales', () => {
    expect(normaliser(formaterMontant(1_500_000))).toBe('15 000 DA')
  })

  it('affiche les decimales lorsqu’il y en a', () => {
    // 150050 centimes = 1500,50 DA
    expect(normaliser(formaterMontant(150_050))).toBe('1 500,50 DA')
  })

  it('affiche zero', () => {
    expect(normaliser(formaterMontant(0))).toBe('0 DA')
  })
})

describe('Calcul du solde d’un traitement', () => {
  it('calcule le reste a payer a partir des paiements valides', () => {
    const solde = calculerSolde(2_000_000, [1_000_000, 1_000_000])
    expect(solde.totalPayeCentimes).toBe(2_000_000)
    expect(solde.resteAPayerCentimes).toBe(0)
  })

  it('gere un traitement partiellement paye', () => {
    const solde = calculerSolde(1_500_000, [500_000])
    expect(solde.totalPayeCentimes).toBe(500_000)
    expect(solde.resteAPayerCentimes).toBe(1_000_000)
  })

  it('gere un traitement sans paiement', () => {
    const solde = calculerSolde(2_000_000, [])
    expect(solde.totalPayeCentimes).toBe(0)
    expect(solde.resteAPayerCentimes).toBe(2_000_000)
  })
})

describe('Prevention du depassement (§17)', () => {
  it('autorise un paiement qui solde exactement le traitement', () => {
    const controle = verifierAbsenceDepassement({
      prixTotalCentimes: 2_000_000,
      totalDejaPayeCentimes: 1_000_000,
      nouveauMontantCentimes: 1_000_000,
    })
    expect(controle.autorise).toBe(true)
    expect(controle.resteApresPaiement).toBe(0)
    expect(controle.depassement).toBe(0)
  })

  it('refuse un paiement qui depasse le prix total', () => {
    const controle = verifierAbsenceDepassement({
      prixTotalCentimes: 2_000_000,
      totalDejaPayeCentimes: 1_000_000,
      nouveauMontantCentimes: 1_500_000,
    })
    expect(controle.autorise).toBe(false)
    expect(controle.depassement).toBe(500_000)
  })

  it('refuse un paiement deja entièrement solde', () => {
    const controle = verifierAbsenceDepassement({
      prixTotalCentimes: 2_000_000,
      totalDejaPayeCentimes: 2_000_000,
      nouveauMontantCentimes: 100,
    })
    expect(controle.autorise).toBe(false)
    expect(controle.depassement).toBe(100)
  })
})

/**
 * =============================================================================
 *  SCENARIO COMPLET DE LA SPECIFICATION (§44)
 * =============================================================================
 *
 *  Patient Ahmed.
 *    Traitement 1 : Devitalisation, dent 36, 20 000 DA.
 *      Paiement 1 : 10 000 DA  -> reste 10 000 DA
 *      Paiement 2 : 10 000 DA  -> reste 0 DA. Traitement termine.
 *    Traitement 2 : Couronne, dent 11, 15 000 DA.
 *      Paiement 3 : 5 000 DA   -> reste 10 000 DA
 *
 *  Totaux patient attendus :
 *    Traitements = 35 000 DA
 *    Paye        = 25 000 DA
 *    Reste       = 10 000 DA
 */
describe('Scenario complet — patient Ahmed (§44)', () => {
  it('calcule correctement les deux traitements et les totaux patient', () => {
    // Traitement 1 : 20 000 DA, dent 36
    const traitement1 = 2_000_000
    // Deux paiements de 10 000 DA
    const solde1 = calculerSolde(traitement1, [1_000_000, 1_000_000])
    expect(solde1.resteAPayerCentimes).toBe(0)

    // Traitement 2 : 15 000 DA, dent 11
    const traitement2 = 1_500_000
    // Un paiement de 5 000 DA
    const solde2 = calculerSolde(traitement2, [500_000])
    expect(solde2.resteAPayerCentimes).toBe(1_000_000)

    // Totaux patient = somme des donnees reelles, jamais stockee.
    const totalTraitements = traitement1 + traitement2
    const totalPaye = solde1.totalPayeCentimes + solde2.totalPayeCentimes
    const reste = totalTraitements - totalPaye

    expect(totalTraitements).toBe(3_500_000) // 35 000 DA
    expect(totalPaye).toBe(2_500_000) // 25 000 DA
    expect(reste).toBe(1_000_000) // 10 000 DA
  })

  it('le chiffre d’affaires est la somme des paiements reels, pas des prix', () => {
    // Le traitement 1 est facture 20 000 DA mais n'a genere que 20 000 DA de
    // paiements ; le traitement 2 est facture 15 000 DA mais seuls 5 000 DA ont
    // ete encaisses. Le revenu du mois doit etre 25 000 DA, PAS 35 000 DA.
    const paiementsEncaisses = [1_000_000, 1_000_000, 500_000]
    const revenu = paiementsEncaisses.reduce((somme, montant) => somme + montant, 0)
    expect(revenu).toBe(2_500_000) // 25 000 DA — et non 35 000 DA
  })
})
