/**
 * =============================================================================
 *  REGLES METIER — TABLEAU DE BORD, RENDEZ-VOUS ET RAPPORTS
 * =============================================================================
 *
 *  Ces tests verrouillent trois exigences qui se lisent sur l'ecran :
 *
 *   1. Le tableau de bord annonce « Montants restant dus par les patients », avec
 *      le nombre de paiements SOUS le montant. Le montant reste celui calcule par
 *      la base (`totalRestantARecevoir`) : aucune nouvelle formule ne doit
 *      apparaitre dans l'interface.
 *
 *   2. « Confirme » a disparu du vocabulaire VISIBLE des rendez-vous, et
 *      « Planifie » est bien un etat selectionnable. Aucun changement de statut
 *      automatique ne doit exister.
 *
 *   3. La suppression d'un rendez-vous passe par la CORBEILLE existante et par
 *      une CONFIRMATION explicite : le premier clic ne supprime rien.
 *
 *  L'analyse est faite sur les SOURCES : ces fichiers ne contiennent pas de
 *  composants React et les rendre necessiterait un navigateur. Ce que ces tests
 *  verrouillent, c'est l'absence de regression dans le code, pas le rendu.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const racine = fileURLToPath(new URL('../../', import.meta.url))
const lire = (chemin: string): string => readFileSync(`${racine}${chemin}`, 'utf8')

const tableauDeBord = lire('src/components/dashboard/donnees-tableau-bord.tsx')
const contenu = JSON.parse(lire('content/fr.json')) as Record<string, never>
const planning = lire('src/components/rendez-vous/planning-rendez-vous.tsx')
const rapports = lire('src/components/rapports/rapports.tsx')

const libellesStatuts = (contenu as unknown as { rendezVous: { statuts: Record<string, string> } })
  .rendezVous.statuts

describe('Tableau de bord — montants restant dus par les patients', () => {
  it('n’affiche plus « Credit a recevoir »', () => {
    const libelle = (contenu as unknown as { tableauDeBord: Record<string, string> }).tableauDeBord
      .creditARecevoir
    expect(libelle).toBe('Montants restant dus par les patients')
  })

  it('affiche le nombre de paiements sous le montant', () => {
    // La ligne secondaire porte le compte : elle doit trainer le nombre renvoyé
    // par l'API, pas une valeur codede en dur.
    expect(tableauDeBord).toContain('donnees.nombrePaiementsTotal')
    expect(tableauDeBord).toContain("t('tableauDeBord.nombrePaiementsAide')")
  })

  it('reste base sur le calcul existant, sans formule repetee', () => {
    const service = lire('backend/services/reports.service.ts')
    // Le montant vient toujours du service de paiements : pas de soustraction
    // facture_moins_paiement introduite dans l'interface ou ailleurs.
    expect(service).toContain('totalRestantARecevoir()')
    expect(tableauDeBord).not.toMatch(/prixTotalCentimes\s*-/)
  })
})

describe('Rendez-vous — vocabulaire de statut', () => {
  it('ne propose que les quatre statuts demandes', () => {
    const valeurs = [...planning.matchAll(/\{ valeur: '([A-Z_]+)', libelle: t\('rendezVous\.statuts/g)].map(
      (correspondance) => correspondance[1],
    )
    // Le selecteur de ligne ET le filtre de la barre d'outils.
    expect(valeurs).toContain('PLANIFIE')
    expect(valeurs).toContain('TERMINE')
    expect(valeurs).toContain('ABSENT')
    expect(valeurs).toContain('REPROGRAMME')
    expect(valeurs).not.toContain('CONFIRME')
    expect(valeurs).not.toContain('EN_ATTENTE')
    expect(valeurs).not.toContain('EN_COURS')
  })

  it('n’expose plus la mention « Confirme » dans un libelle visible', () => {
    expect(libellesStatuts.CONFIRME).not.toBe('Confirmé')
    expect(JSON.stringify(contenu)).not.toContain('"Confirmé"')
  })

  it('cree toujours un rendez-vous « Planifie » sans reconversion d’etat', () => {
    const service = lire('backend/services/appointments.service.ts')
    // La creation d'un rendez-vous impose PLANIFIE...
    expect(service).toContain("statut: 'PLANIFIE'")
    // ...et aucune ecriture de statut ne depend d'une comparaison a la date du
    // jour : le passage du temps ne peut pas produire « Fait » ni « Absent ».
    expect(service).not.toMatch(/statut\s*=\s*.*maintenant/)
    expect(service).not.toMatch(/statut:\s*dateDebut\s*[<>]/)
  })
})

describe('Rendez-vous — suppression', () => {
  it('ne supprime pas au premier clic : une confirmation est demandee', () => {
    expect(planning).toContain('aSupprimer')
    expect(planning).toContain('supprimerRendezVous')
    expect(planning).toContain("methode: 'DELETE'")
    // Le bouton d'ouverture ne fait qu'ouvrir la question.
    expect(planning).toContain('onClick={() => setASupprimer(rdv.id)}')
  })

  it('reutilise la corbeille du serveur, sans suppression en cascade', () => {
    const route = lire('src/app/api/appointments/[id]/route.ts')
    // La route DELETE existe deja et passe par `mettreEnCorbeille` : suppression
    // logique, aucune donnee liee detruite.
    expect(route).toContain("mettreEnCorbeille('RENDEZ_VOUS'")
    expect(route).toContain('routePriveeAvecId')

    const corbeille = lire('backend/services/trash.service.ts')
    expect(corbeille).toContain(
      'Supprimer un rendez-vous ne touche NI le traitement NI le paiement',
    )
  })

  it('signale l’echec sans retirer le rendez-vous de la liste', () => {
    // En cas d'erreur, la liste est rechargee : l'element y figure toujours.
    expect(planning).toContain('notifications.erreur(')
    expect(planning).toContain('supprimerReussie')
  })
})

describe('Rapports — « Personnaliser » n’est pas une erreur', () => {
  it('distingue « periode en attente de dates » de « requete en echec »', () => {
    // Le bug : `erreur || !synthese` faisait passer « pas encore de requete »
    // pour un echec, affichant « Une erreur interne est survenue ».
    expect(rapports).toContain('enAttente')
    expect(rapports).toContain('rapports.periodeEnAttente')
    // Le garde-fou doit preceder le test d'erreur.
    const ordre = rapports.indexOf('if (enAttente)')
    expect(ordre).toBeGreaterThan(-1)
    expect(ordre).toBeLessThan(rapports.indexOf('if (erreur || !synthese)'))
  })

  it('n’emet aucune requete tant que les deux dates ne sont pas saisies', () => {
    expect(rapports).toContain('periodeExploitable ? `/api/reports/revenue?rapport=synthese')
    expect(rapports).toContain('if (!du || !au) return')
  })

  it('laisse le composant ChampDate intact et editable', () => {
    // Le composant de saisie existant n'est ni remplace ni neutralise.
    expect(rapports).toContain('import { ChampDate, ChampSelection }')
    expect(rapports).not.toMatch(/ChampDate[^}]*readOnly/)
    expect(rapports).not.toMatch(/ChampDate[^}]*disabled/)
  })
})