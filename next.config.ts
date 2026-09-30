import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import type { NextConfig } from 'next'

const racineProjet = dirname(fileURLToPath(import.meta.url))

/**
 * En-tetes de securite appliques par Next.js.
 *
 * Les valeurs sont volontairement definies ici (et non dans un middleware)
 * pour qu'elles soient presentes meme sur les reponses servies sans passer
 * par le middleware (fichiers statiques, erreurs internes).
 *
 * La CSP precise est construite dans `backend/security/content-security-policy.ts`
 * et appliquee par le middleware, car elle depend d'un nonce par requete.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), usb=(), payment=()',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Resource-Policy',
    value: 'same-origin',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Fixe explicitement la racine du projet : une machine comportant plusieurs
  // fichiers `package-lock.json` ferait autrement deviner la mauvaise racine.
  outputFileTracingRoot: racineProjet,
  // Le lint est une etape de verification SEPAREE (`npm run lint`, avec
  // `--max-warnings=0`). L'executer aussi pendant le build doublerait le temps
  // sans rien garantir de plus, et masquerait les erreurs de build derriere des
  // avertissements de style.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Les traces d'erreur ne doivent jamais fuiter vers le client en production.
  productionBrowserSourceMaps: false,
  experimental: {
    // Les documents patients ne transitent que par des routes API validees.
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Le site public ne doit jamais etre mis en cache avec des donnees privees.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ]
  },
}

export default nextConfig
