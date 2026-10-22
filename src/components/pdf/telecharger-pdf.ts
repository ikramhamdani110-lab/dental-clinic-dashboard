'use client'

/**
 * =============================================================================
 *  TELECHARGEMENT DE PDF COTE NAVIGATEUR
 * =============================================================================
 *
 *  Recupere un document PDF produit PAR LE SERVEUR (routes privees
 *  /api/.../pdf) et declenche le telechargement via un blob.

 *  POURQUOI PAS UN IFRAME CACHE : les reponses de l'application portent
 *  `X-Frame-Options: DENY` (en-tete de securite global, cf. next.config.ts).
 *  Le navigateur refuse donc de charger la reponse dans un cadre, et le
 *  telechargement — sense etre lance par l'en-tete `Content-Disposition` — ne
 *  demarre JAMAIS : le clic sur « Exporter PDF » semblait ne rien faire.

 *  Le passage par `fetch` + blob n'affaiblit PAS la securite :
 *    - la requete part same-origin AVEC le cookie de session (HttpOnly) ;
 *    - methode GET : aucune protection CSRF requise (aucune mutation) ;
 *    - le document ne transite que par la memoire du navigateur ;
 *    - une reponse d'erreur (401/403/429/500) est DETECTEE et signalée,
 *      au lieu d'etre silencieusement affichee dans un cadre invisible.

 *  Le nom de fichier vient de l'en-tete `Content-Disposition` quand il est
 *  present (le serveur le construit deja, sanitisé), sinon d'un prefixe
 *  fourni par l'appelant + la date du jour.
 */

interface ReponsePdf {
  /** Nom de fichier determine a partir de la reponse du serveur. */
  nomFichier: string
}

async function extraireNomFichier(reponse: Response): Promise<string | null> {
  const disposition = reponse.headers.get('Content-Disposition')
  if (!disposition) return null
  // RFC 5987 : filename*=UTF-8''... d'abord (noms avec accents), sinon filename=...
  const etendu = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)
  const nomEtendu = etendu?.[1]
  if (nomEtendu) {
    try {
      return decodeURIComponent(nomEtendu)
    } catch {
      return nomEtendu
    }
  }
  const simple = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  const nomSimple = simple?.[1]
  return nomSimple ?? null
}

/**
 * Télécharge le PDF d'une route privée. Rejette si la réponse n'est pas un
 * document (erreur d'authentification, rate limit, erreur serveur) : le
 * message affiché est générique, le détail reste dans les journaux serveur.
 */
export async function telechargerPdf(
  url: string,
  nomDeSecours: string,
): Promise<ReponsePdf> {
  const reponse = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/pdf' },
  })

  const type = reponse.headers.get('Content-Type') ?? ''

  if (!reponse.ok || !type.includes('application/pdf')) {
    // L'API renvoie du JSON d'erreur (401 session expiree, 429, 500...) :
    // on le consomme pour liberer la connexion et on rejette.
    await reponse.arrayBuffer().catch(() => undefined)
    throw new Error(`Export impossible (${reponse.status})`)
  }

  const nomServeur = await extraireNomFichier(reponse)
  const nomFichier = nomServeur ?? `${nomDeSecours}-${new Date().toISOString().slice(0, 10)}.pdf`

  const blob = await reponse.blob()
  const urlObjet = URL.createObjectURL(blob)
  const lien = document.createElement('a')
  lien.href = urlObjet
  lien.download = nomFichier
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  // Le blob est libere après le cycle en cours : le téléchargement partira
  // même si l'onglet est fermé peu après.
  window.setTimeout(() => URL.revokeObjectURL(urlObjet), 10_000)

  return { nomFichier }
}
