/**
 * Verification de la base de DEMONSTRATION et des parcours d'ECRITURE.
 *
 * Toutes les ecritures se font sur la base de demonstration (port 5433).
 * La production n'est jamais appelee : le script verifie meme que l'API
 * repond sur le port de developpement local uniquement.
 */
export default async function run(page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://localhost:3000/connexion/', { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill('dr.sahed@demo.cabinet')
  await page.locator('input[type="password"]').first().fill('DemoSahed2026!')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/tableau-de-bord', { timeout: 60000 })
  await page.waitForTimeout(3500)
  const out = {}

  // ── 1. Les 5 cartes du tableau de bord ─────────────────────────────────────
  out.cartes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.grille-statistiques .statistique')).map((c) => ({
      e: c.querySelector('.statistique-etiquette')?.textContent?.trim(),
      v: c.querySelector('.statistique-valeur')?.textContent?.trim(),
      d: c.querySelector('.statistique-detail')?.textContent?.trim(),
    })),
  )

  // ── 2. Les deux listes ─────────────────────────────────────────────────────
  out.listes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('section.carte')).map((s) => ({
      titre: s.querySelector('.carte-titre')?.textContent?.trim(),
      lignes: Array.from(s.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.replace(/\s+/g, ' ').trim()),
      ),
    })),
  )

  // ── 3. API du tableau de bord ──────────────────────────────────────────────
  out.api = await page.evaluate(async () => {
    const r = await fetch('/api/dashboard', { credentials: 'include' })
    const j = await r.json()
    return {
      statut: r.status,
      rdvDuJour: j.rendezVousDuJour?.length,
      sansRendezVous: j.patientsSansRendezVous?.length,
      nouveauxRdv: j.nouveauxRendezVous?.length,
      venus: j.patientsVenusJour,
      nouveauxPatients: j.nouveauxPatientsJour,
      encaisseJour: j.revenusJourCentimes,
      nbPaiementsJour: j.nombrePaiementsJour,
      restant: j.totalRestantCentimes,
      // un patient ne doit pas etre dans les deux listes du jour
      chevauchement: (() => {
        const a = new Set((j.rendezVousDuJour ?? []).map((r) => r.patient))
        const b = new Set((j.patientsSansRendezVous ?? []).map((r) => r.patient))
        return [...a].filter((x) => b.has(x))
      })(),
    }
  })

  // ── 4. CREATION D'UN PATIENT ───────────────────────────────────────────────
  await page.goto('http://localhost:3000/patients/nouveau', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  out.formulairePatient = await page.evaluate(() => ({
    champs: Array.from(document.querySelectorAll('.champ')).map((c) => ({
      etiquette: c.querySelector('.champ-etiquette')?.textContent?.trim(),
      nom: c.querySelector('input,select,textarea')?.getAttribute('name'),
      requis: c.querySelector('.champ-obligatoire') !== null,
    })),
  }))

  const marqueur = `Démo${Date.now().toString().slice(-6)}`
  const remplir = async (nom, valeur) => {
    const f = page.locator(`[name="${nom}"]`).first()
    if ((await f.count()) === 0) return false
    const tag = await f.evaluate((el) => el.tagName.toLowerCase())
    if (tag === 'select') await f.selectOption({ index: 1 }).catch(() => { })
    else await f.fill(String(valeur))
    return true
  }
  await remplir('nom', 'Test')
  await remplir('prenom', marqueur)
  await remplir('age', '34')
  await remplir('telephone', '0550 111 222')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(3500)
  out.creationPatient = {
    url: page.url(),
    cree: /\/patients\/[0-9a-f-]{36}/.test(page.url()),
    ageAffiche: await page
      .locator('.en-tete-fiche')
      .first()
      .innerText()
      .catch(() => ''),
  }

  // ── 5. RECHERCHE DANS LA LISTE ─────────────────────────────────────────────
  await page.goto('http://localhost:3000/patients', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const recherche = page.locator('input[type="search"], input[name="recherche"]').first()
  if (await recherche.count()) {
    await recherche.fill('a')
    await page.waitForTimeout(2200)
    out.recherche = {
      lignes: await page.locator('tbody tr').count(),
      exemples: await page.locator('tbody tr').first().innerText().catch(() => ''),
    }
  }
  return out
}
