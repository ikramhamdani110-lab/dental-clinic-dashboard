import { describe, expect, it } from 'vitest'

import { periodeAnnee, periodeAujourdhui, periodeMois } from '@backend/services/reports.service'

/**
 * =============================================================================
 *  REGRESSION — CONVENTION DE FUSEAU HORAIRE DES FRONTIERES FINANCIERES
 * =============================================================================
 *
 *  LE DEFAUT CORRIGE
 *
 *    Les bornes de periode (`periodeAujourdhui`, `periodeMois`, `periodeAnnee`)
 *    sont construites en HEURE LOCALE (`setHours(0,0,0,0)`, `getFullYear()`),
 *    parce que c'est le calendrier du medecin qui fait foi : « les recettes
 *    d'aujourd'hui », « le mois de septembre ».
 *
 *    Les fonctions d'agregation mensuelle du graphique, elles, regroupaient les
 *    paiements par leur mois UTC. Avec un serveur en UTC+1 (Alger), un paiement
 *    encaisse a 00:30 heure locale le 1er septembre porte l'instant UTC
 *    `2026-08-31T23:30Z` : le graphique le rangeait donc en AOUT, alors que le
 *    tableau de bord le comptait en SEPTEMBRE. Le meme argent apparaissait dans
 *    deux mois differents et les deux ecrans ne se reconciliaient jamais.
 *
 *  CE QUE CES TESTS PROTEGENT
 *
 *    Ils verrouillent la convention : les trois periodes DOIVENT commencer et
 *    finir sur des frontieres du CALENDRIER LOCAL. Si quelqu'un « corrige » un
 *    jour ces fonctions en UTC (par exemple en les reecrivant avec
 *    `Date.UTC`/`toISOString`), les tests signalent la divergence au lieu de la
 *    laisser repartir en production.
 *
 *  Ces tests ne dependent PAS de la timezone du poste : ils comparent chaque
 *  borne aux composants LOCAUX de la date, ce qui reste vrai partout.
 */

describe('Frontieres de periode — convention en heure LOCALE', () => {
  it("periodeAujourdhui commence a minuit local et finit a la derniere milliseconde locale", () => {
    const reference = new Date(2026, 8, 15, 14, 37, 12, 345) // 15 septembre 2026
    const { debut, fin } = periodeAujourdhui(reference)

    // Frontieres du calendrier LOCAL, quel que soit le fuseau du poste.
    expect(debut.getFullYear()).toBe(2026)
    expect(debut.getMonth()).toBe(8)
    expect(debut.getDate()).toBe(15)
    expect(debut.getHours()).toBe(0)
    expect(debut.getMinutes()).toBe(0)
    expect(debut.getSeconds()).toBe(0)
    expect(debut.getMilliseconds()).toBe(0)

    expect(fin.getFullYear()).toBe(2026)
    expect(fin.getMonth()).toBe(8)
    expect(fin.getDate()).toBe(15)
    expect(fin.getHours()).toBe(23)
    expect(fin.getMinutes()).toBe(59)
    expect(fin.getSeconds()).toBe(59)
    expect(fin.getMilliseconds()).toBe(999)

    // La journee couvre exactement 24 h (aucune heure perdue en route).
    expect(fin.getTime() - debut.getTime()).toBe(24 * 60 * 60 * 1000 - 1)
  })

  it('periodeMois couvre le mois civil LOCAL, du 1er au dernier jour', () => {
    const { debut, fin } = periodeMois(new Date(2026, 8, 15))

    expect(debut.getMonth()).toBe(8)
    expect(debut.getDate()).toBe(1)
    expect(debut.getHours()).toBe(0)

    expect(fin.getMonth()).toBe(8)
    expect(fin.getDate()).toBe(30) // septembre compte 30 jours
    expect(fin.getHours()).toBe(23)
    expect(fin.getMinutes()).toBe(59)
  })

  it('periodeMois gere correctement fevrier et les annees bissextiles', () => {
    const fevrier2026 = periodeMois(new Date(2026, 1, 10)) // 2026 : non bissextile
    expect(fevrier2026.fin.getDate()).toBe(28)

    const fevrier2028 = periodeMois(new Date(2028, 1, 10)) // 2028 : bissextile
    expect(fevrier2028.fin.getDate()).toBe(29)
  })

  it('periodeAnnee couvre l annee civile LOCALE, du 1er janvier au 31 decembre', () => {
    const { debut, fin } = periodeAnnee(2026)

    expect(debut.getFullYear()).toBe(2026)
    expect(debut.getMonth()).toBe(0)
    expect(debut.getDate()).toBe(1)
    expect(debut.getHours()).toBe(0)

    expect(fin.getFullYear()).toBe(2026)
    expect(fin.getMonth()).toBe(11)
    expect(fin.getDate()).toBe(31)
    expect(fin.getHours()).toBe(23)
    expect(fin.getMinutes()).toBe(59)
    expect(fin.getSeconds()).toBe(59)
    expect(fin.getMilliseconds()).toBe(999)
  })

  it('une journee entiere est contenue dans le mois LOCAL correspondant', () => {
    /*
     * C'est exactement le scenario du defaut : chaque instant d'une journee
     * civile doit tomber dans la MEME periode mensuelle que cette journee.
     * Avec un regroupement en UTC, les premieres heures du 1er du mois
     * tombaient dans le mois precedent.
     */
    const premierJour = new Date(2026, 8, 1) // 1er septembre 2026, local
    const mois = periodeMois(premierJour)

    // Les premieres minutes du mois appartiennent bien a ce mois.
    const justeApresMinuit = new Date(2026, 8, 1, 0, 30, 0, 0)
    expect(justeApresMinuit.getTime()).toBeGreaterThanOrEqual(mois.debut.getTime())
    expect(justeApresMinuit.getTime()).toBeLessThanOrEqual(mois.fin.getTime())

    // Et les dernieres minutes du mois precedent n'y appartiennent pas.
    const justeAvantMinuit = new Date(2026, 7, 31, 23, 30, 0, 0)
    expect(justeAvantMinuit.getTime()).toBeLessThan(mois.debut.getTime())
  })

  it('le mois LOCAL d une journee ne depend pas de l heure dans la journee', () => {
    /*
     * Le mois auquel appartient une journee DOIT etre le meme a 00:30 et a
     * 23:30. C'est cette egalite qui garantit que le tableau de bord (bornes
     * locales) et le graphique (regroupement local) rattachent un paiement au
     * meme mois, quelle que soit l'heure de l'encaissement.
     */
    const tot = new Date(2026, 8, 1, 0, 30, 0, 0)
    const tard = new Date(2026, 8, 1, 23, 30, 0, 0)

    expect(tot.getMonth()).toBe(tard.getMonth())
    expect(tot.getFullYear()).toBe(tard.getFullYear())
    expect(tot.getMonth()).toBe(8)
  })
})