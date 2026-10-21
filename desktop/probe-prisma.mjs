// Verification : @prisma/client est-il utilisable depuis resources\standalone ?
const racine = process.cwd()
const cheminClient = 'file:///' + racine.replace(/\\/g, '/') + '/desktop/resources/standalone/node_modules/@prisma/client/index.js'

try {
  const m = await import(cheminClient)
  const p = new m.PrismaClient()
  console.log('has $executeRawUnsafe:', typeof p.$executeRawUnsafe)
  console.log('has $queryRawUnsafe:', typeof p.$queryRawUnsafe)
  console.log('has $transaction:', typeof p.$transaction)
  await p.$disconnect()
  console.log('CLIENT PRISMA OK')
} catch (e) {
  console.error('ERREUR:', e.message)
  process.exit(1)
}
