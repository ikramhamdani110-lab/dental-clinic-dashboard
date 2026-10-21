// Génère desktop/ico/icon.ico (multi-résolution, ICO « PNG-compressed » Vista+)
// Icône "dent" simple sur fond bleu nuit — utilise sharp (déjà présent).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dossier = path.join(racine, 'desktop', 'ico')
fs.mkdirSync(dossier, { recursive: true })

async function pngViaSharp(taille) {
  const sharp = (await import('sharp')).default

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${taille}" height="${taille}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="18" fill="#05316E"/>
  <path fill="#F5F8FC" d="M50 14 C64 14 80 24 80 42 C80 58 73 66 71 84 C70 92 61 94 59 86 L55 62 L45 62 L41 86 C39 94 30 92 29 84 C27 66 20 58 20 42 C20 24 36 14 50 14 Z"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const tailles = [256, 128, 64, 48, 32, 16]
const pngs = []
for (const t of tailles) pngs.push(await pngViaSharp(t))
const entete = Buffer.alloc(6)
entete.writeUInt16LE(0, 0)
entete.writeUInt16LE(1, 2) // type ICO
entete.writeUInt16LE(tailles.length, 4)
const repertoire = Buffer.alloc(16 * tailles.length)
let offset = 6 + 16 * tailles.length
tailles.forEach((t, i) => {
  const e = repertoire.subarray(i * 16, i * 16 + 16)
  e[0] = t === 256 ? 0 : t
  e[1] = t === 256 ? 0 : t
  e.writeUInt16LE(1, 4) // plans
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(pngs[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
})
const ico = Buffer.concat([entete, repertoire, ...pngs])
fs.writeFileSync(path.join(dossier, 'icon.ico'), ico)

// Aperçu PNG 256px pour vérification visuelle.
fs.writeFileSync(path.join(dossier, 'icon-preview.png'), pngs[0])
console.log('Icône générée :', path.join(dossier, 'icon.ico'), ico.length, 'octets')
