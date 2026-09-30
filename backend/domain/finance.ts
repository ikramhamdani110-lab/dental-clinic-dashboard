/**
 * =============================================================================
 *  MONTANTS — CENTIMES ET FORMATAGE (§12, §16, §44)
 * =============================================================================
 *
 *  REGLE ABSOLUE : les montants sont stockes en CENTIMES, en ENTIERS.
 *  Un montant en flottant introduirait des erreurs d'arrondi invisibles qui,
 *  accumulees sur des milliers de paiements, rendraient les soldes faux.
 *
 *  La devise du cabinet est le DINAR ALGERIEN (DA). La plus petite unite
 *  utilisee en pratique est le dinar ; les montants sont donc saisis en dinars
 *  et convertis en centimes au stockage, ce qui laisse la porte ouverte a des
 *  sous-unites sans migration.
 */

/**
 * Montant en centimes -> chaine lisible en dinars (ex. 2000000 -> « 20 000 DA »).
 * Les decimales ne sont affichees que si le montant n'est pas rond.
 */
export function formaterMontant(centimes: number): string {
  const dinars = Math.round(centimes) / 100
  const aDesDecimales = Math.abs(dinars % 1) > 1e-9
  const groupe = dinars.toLocaleString('fr-FR', {
    minimumFractionDigits: aDesDecimales ? 2 : 0,
    maximumFractionDigits: 2,
  })
  return `${groupe} DA`
}

/**
 * Convertit une saisie utilisateur (dinars) en centimes entiers.
 * Acc 1 500 », « 1500,50 », « 1500.50 ».
 * Renvoie `null` si la saisie n'est pas un montant exploitable.
 */
export function parseMontantEnCentimes(saisie: string): number | null {
  const nettoye = saisie.replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(nettoye)) return null
  const dinars = Number.parseFloat(nettoye)
  if (!Number.isFinite(dinars)) return null
  return Math.round(dinars * 100)
}

/** Convertit des centimes en dinars decimaux, pour le pre-remplissage des formulaires. */
export function centimesVersDinars(centimes: number): number {
  return Math.round(centimes) / 100
}

/**
 * Calcule le solde d'une serie de paiements valides.
 * Ne stocke jamais le resultat : il est toujours recalcule a la lecture (§12).
 */
export function calculerSolde(
  prixTotalCentimes: number,
  montantsValidesCentimes: readonly number[],
): { totalPayeCentimes: number; resteAPayerCentimes: number } {
  const totalPayeCentimes = montantsValidesCentimes.reduce((somme, montant) => somme + montant, 0)
  return {
    totalPayeCentimes,
    resteAPayerCentimes: prixTotalCentimes - totalPayeCentimes,
  }
}

/**
 * Verifie qu'un nouveau paiement ne ferait pas depasser le prix total du
 * traitement (§17).
 *
 * Politique V1 : AUCUN depassement n'est autorise. Le medecin doit d'abord
 * corriger le prix du traitement ou annuler le paiement errone. Cette regle est
 * volontairement stricte : un depassement silencieux masquerait une erreur de
 * saisie, exactement ce que la specification interdit.
 */
export function verifierAbsenceDepassement(params: {
  prixTotalCentimes: number
  totalDejaPayeCentimes: number
  nouveauMontantCentimes: number
}): { autorise: boolean; resteApresPaiement: number; depassement: number } {
  const resteAvant = params.prixTotalCentimes - params.totalDejaPayeCentimes
  const resteApresPaiement = resteAvant - params.nouveauMontantCentimes
  const depassement = Math.max(0, -resteApresPaiement)

  return {
    autorise: depassement === 0,
    resteApresPaiement,
    depassement,
  }
}
