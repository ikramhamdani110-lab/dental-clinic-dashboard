import { describe, expect, it } from 'vitest'

import { libelleStatutJour } from '@/components/dashboard/donnees-tableau-bord'

/**
 * =============================================================================
 *  REGRESSION — LE STATUT N'EST JAMAIS DEDUIT DE LA DATE (§ tableau de bord)
 * =============================================================================
 *
 *  Le tableau de bord affichait jusqu'ici un statut CALCULE, qui comparait
 *  l'heure du rendez-vous a l'instant present :
 *
 *      creneau termine + statut ouvert  ->  « N'est pas venu »
 *      creneau termine + statut termine  ->  « Fait »
 *      creneau a venir                   ->  « Reprogramme »
 *
 *  Consequence : un rendez-vous cree pour le 5 octobre, jamais touche par le
 *  medecin, s'affichait « N'est pas venu » des le 5 octobre au soir. Le systeme
 *  AFFIRMAIT donc une absence, et « Fait », a la place du medecin et sans
 *  aucune decision de sa part.
 *
 *  Ce que verrouille ce test :
 *
 *    - l'affichage renvoie l'etat ENREGISTRE, whatever soit la date ;
 *    - `dateFin` et l'instant present ne sont plus des entrees de la decision ;
 *    - aucun statut n'est invente : une valeur inconnue ressort telle quelle.
 *
 *  Le statut « Fait » ne peut donc provenir que d'un changement EXPLICITE
 *  (selection du medecin dans la colonne « Statut »), jamais du passage du temps.
 */

describe('Tableau de bord — le statut affiche est celui enregistre', () => {
  it('un rendez-vous PLANIFIE reste PLANIFIE, sans egard a la date du jour', () => {
    expect(libelleStatutJour('PLANIFIE')).toBe('PLANIFIE')
  })

  it('un rendez-vous passe non plus ne devient ni Fait ni Absent tout seul', () => {
    // La regression exacte : le cas « cree le 30/09 pour le 02/10, consulte le
    // 03/10 ». L'affichage doit toujours dire PLANIFIE.
    const aujourdhui = 3
    const jourDuRendezVous = 2
    expect(jourDuRendezVous).toBeLessThan(aujourdhui)
    expect(libelleStatutJour('PLANIFIE')).toBe('PLANIFIE')
  })

  it('reproduit l affichage de tous les statuts selectionnables par le medecin', () => {
    // Les quatre choix proposes dans le planning. Chacun doit ressortir tel quel.
    expect(libelleStatutJour('PLANIFIE')).toBe('PLANIFIE')
    expect(libelleStatutJour('TERMINE')).toBe('TERMINE')
    expect(libelleStatutJour('ABSENT')).toBe('ABSENT')
    expect(libelleStatutJour('REPROGRAMME')).toBe('REPROGRAMME')
  })

  it('ne reclasse pas un rendez-vous termine en « a venir »', () => {
    // L ancien code devolvait « Reprogramme » pour TOUT creneau non acheve, y
    // compris un rendez-vous explicitement marque termine par le medecin.
    expect(libelleStatutJour('TERMINE')).not.toBe('REPROGRAMME')
  })

  it('conserve les statuts d organisation historiques, sans les traduire en faux etat', () => {
    // CONFIRME / EN_ATTENTE / EN_COURS sont des valeurs possibles d un
    // enregistrement ancien. Elles ne doivent pas etre remappees sur « Absent ».
    expect(libelleStatutJour('CONFIRME')).toBe('CONFIRME')
    expect(libelleStatutJour('EN_ATTENTE')).toBe('EN_ATTENTE')
    expect(libelleStatutJour('EN_COURS')).toBe('EN_COURS')
  })

  it('laisse passer une valeur inconnue plutot que d inventer un statut', () => {
    // Pas de valeur de repli « Fait » ou « Absent » : une donnee non reconnue
    // doit rester visible telle quelle pour ne pas mentir sur son contenu.
    expect(libelleStatutJour('QUELQUE_CHOSE')).toBe('QUELQUE_CHOSE')
  })

  it('n accepte plus de reference a la date : la signature est le statut seul', () => {
    // Erreur de compilation volontaire si quelqu'un reintroduit `dateFin` ou
    // `maintenant` : le type les refuserait, ce test le documente.
    expect(libelleStatutJour.length).toBe(1)
  })
})
