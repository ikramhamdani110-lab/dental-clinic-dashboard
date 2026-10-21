// =============================================================================
//  SEED DU COMPTE MEDECIN — VERSION BUREAU (CommonJS autonome)
// =============================================================================
//  Créé au premier lancement de l'application de bureau. Reproduit exactement
//  `database/seed.ts` (hachage Argon2id + pepper) sans TypeScript, pour être
//  exécutable par le Node embarqué d'Electron.
// =============================================================================

const path = require('node:path')
const dossierStandalone = path.resolve(__dirname, '..', 'standalone')
const { PrismaClient } = require(path.join(dossierStandalone, 'node_modules', '@prisma', 'client'))
const argon2 = require(path.join(dossierStandalone, 'node_modules', 'argon2'))

const prisma = new PrismaClient()

async function main() {
  const email = process.env.DOCTOR_EMAIL
  const nom = process.env.DOCTOR_NAME
  const motDePasse = process.env.DOCTOR_INITIAL_PASSWORD
  const pepper = process.env.PASSWORD_PEPPER

  const manquants = []
  if (!email) manquants.push('DOCTOR_EMAIL')
  if (!nom) manquants.push('DOCTOR_NAME')
  if (!motDePasse) manquants.push('DOCTOR_INITIAL_PASSWORD')
  if (!pepper) manquants.push('PASSWORD_PEPPER')
  if (manquants.length > 0) {
    throw new Error('Variables manquantes : ' + manquants.join(', '))
  }

  const hash = await argon2.hash(`${motDePasse}${pepper}`, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  // Sentinela de primeira conexão: um `passwordChangedAt` no passado distante
  // (época Unix) indica que o utilizador ainda NUNCA alterou a senha. O login
  // interpreta isso como "password change obrigatório no primeiro acesso".
  const primeiraConexao = process.env.FORCE_FIRST_LOGIN_PASSWORD_CHANGE === 'true'
  const passwordChangedAt = primeiraConexao ? new Date(0) : new Date()

  // Email normalise : unicite insensible a la casse (identique a database/seed.ts).
  const emailNormalise = email.trim().toLowerCase()

  const existant = await prisma.user.findFirst({
    where: { email: { equals: emailNormalise, mode: 'insensitive' } },
    select: { id: true },
  })

  if (existant) {
    // COMPTE EXISTANT : on ne touche a RIEN — le seed ne reinitialise JAMAIS le
    // mot de passe d'un compte reel deja en service (seed non destructif).
    console.log('Compte medecin deja existant :', emailNormalise, '— aucune modification.')
    return
  }

  await prisma.user.create({
    data: {
      email: emailNormalise,
      displayName: nom,
      role: 'MEDECIN',
      passwordHash: hash,
      isActive: true,
      passwordChangedAt,
    },
  })
  console.log('Compte medecin cree :', emailNormalise)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
