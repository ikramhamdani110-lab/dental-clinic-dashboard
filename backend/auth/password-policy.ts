/**
 * =============================================================================
 *  POLITIQUE DE MOT DE PASSE — SOURCE UNIQUE DE VÉRITÉ
 * =============================================================================
 *
 *  Le même module est consommé par :
 *    - le BACKEND (`backend/auth/password.ts`) : la validation qui protège ;
 *    - le FRONTEND (écran de première connexion) : l'affichage en direct des
 *      exigences, pour que l'utilisateur sache ce qui est attendu AVANT de
 *      soumettre.
 *
 *  POURQUOI UN SEUL MODULE
 *    Une règle dupliquée finit toujours par diverger : le formulaire affichait
 *    autrefois des conditions que le serveur n'appliquait pas (ou refusait des
 *    mots de passe que l'écran jugeait valides). Ici, les CONSTANTES et la
 *    fonction de vérification sont partagées : impossible que l'écran et le
 *    serveur racontent deux choses différentes.
 *
 *  Ce module ne contient AUCUN secret et n'a aucun effet de bord : il peut être
 *  importé depuis un composant client sans embarquer de code serveur.
 */

/** Longueur minimale exigée pour un mot de passe. */
export const LONGUEUR_MIN_MOT_DE_PASSE = 12

/** Longueur maximale : borne la charge de hachage (protection anti-DoS). */
export const LONGUEUR_MAX_MOT_DE_PASSE = 200

/**
 * Mots de passe les plus courants : refusés même s'ils satisfont la longueur et
 * la composition. La robustesse formelle ne suffit pas si le mot de passe reste
 * devinable. La comparaison est insensible à la casse et porte sur une
 * SOUS-CHAÎNE (un mot courant noyé dans une chaîne reste faible).
 */
export const MOTS_DE_PASSE_COURANTS: readonly string[] = [
  'motdepasse',
  'password',
  'azertyuiop',
  '123456789012',
  'administrateur',
]

/**
 * Une exigence élémentaire de la politique.
 *
 * `id` est stable et sert de clé d'affichage ; `verifie` décide si la règle est
 * satisfaite. Le libellé est déjà formé, en français, prêt à afficher.
 */
export interface ExigenceMotDePasse {
  id: string
  libelle: string
  verifie: boolean
}

/**
 * Évalue la politique COMPLÈTE sur une chaîne donnée.
 *
 * Renvoie la liste des exigences, chacune avec son état — c'est exactement ce
 * dont l'interface a besoin pour afficher une coche par règle.
 *
 * IMPORTANT : cette évaluation est aussi utilisée par le backend, mais la
 * version FAISANT AUTORITÉ est `problemesMotDePasse` ci-dessous : elle renvoie
 * les messages d'erreur, et c'est elle que le serveur exécute avant de hacher.
 */
export function evaluerExigencesMotDePasse(motDePasse: string): ExigenceMotDePasse[] {
  const minuscule = /[a-z]/.test(motDePasse)
  const majuscule = /[A-Z]/.test(motDePasse)
  const chiffre = /[0-9]/.test(motDePasse)
  const longueurMin = motDePasse.length >= LONGUEUR_MIN_MOT_DE_PASSE
  const longueurMax = motDePasse.length <= LONGUEUR_MAX_MOT_DE_PASSE
  const pasCourant = !MOTS_DE_PASSE_COURANTS.some((mot) => motDePasse.toLowerCase().includes(mot))

  return [
    {
      id: 'longueur-min',
      libelle: `Au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères`,
      verifie: longueurMin,
    },
    {
      id: 'longueur-max',
      libelle: `Au plus ${LONGUEUR_MAX_MOT_DE_PASSE} caractères`,
      verifie: longueurMax,
    },
    { id: 'minuscule', libelle: 'Une lettre minuscule', verifie: minuscule },
    { id: 'majuscule', libelle: 'Une lettre majuscule', verifie: majuscule },
    { id: 'chiffre', libelle: 'Un chiffre', verifie: chiffre },
    {
      id: 'pas-courant',
      libelle: 'Ne pas être un mot de passe courant',
      verifie: pasCourant,
    },
  ]
}

/**
 * Messages d'erreur de la politique, en français, dans l'ordre d'affichage.
 *
 * Liste vide = mot de passe conforme. C'est LA fonction que le backend appelle
 * avant hacher : toute divergence entre l'écran et le serveur doit donc se
 * corriger ici, et nulle part ailleurs.
 */
export function problemesMotDePasse(motDePasse: string): string[] {
  const problemes: string[] = []

  if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
    problemes.push(
      `Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`,
    )
  }
  if (motDePasse.length > LONGUEUR_MAX_MOT_DE_PASSE) {
    problemes.push(`Le mot de passe ne peut pas dépasser ${LONGUEUR_MAX_MOT_DE_PASSE} caractères.`)
  }
  if (!/[a-z]/.test(motDePasse)) problemes.push('Le mot de passe doit contenir une minuscule.')
  if (!/[A-Z]/.test(motDePasse)) problemes.push('Le mot de passe doit contenir une majuscule.')
  if (!/[0-9]/.test(motDePasse)) problemes.push('Le mot de passe doit contenir un chiffre.')

  if (MOTS_DE_PASSE_COURANTS.some((mot) => motDePasse.toLowerCase().includes(mot))) {
    problemes.push('Ce mot de passe est trop courant. Choisissez-en un autre.')
  }

  return problemes
}

/** Vrai si le mot de passe satisfait TOUTES les exigences. */
export function motDePasseConforme(motDePasse: string): boolean {
  return problemesMotDePasse(motDePasse).length === 0
}
