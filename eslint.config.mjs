import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

/**
 * Configuration ESLint (flat config).
 *
 * `--max-warnings=0` est utilise par `npm run lint` : toute alerte fait echouer
 * la verification. Les regles ci-dessous sont volontairement peu nombreuses mais
 * strictes sur ce qui compte pour un systeme medical : pas de `any` implicite,
 * pas de variable inutilisee, pas de console.log abandonne en production.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      '.dist/**',
      '.local/**',
      '.tmp/**',
      '.preview/**',
      'storage/**',
      'database/prisma/generated/**',
      'database/prisma/local/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Les scripts d'outillage Node (seed, sauvegardes) s'executent hors
    // application : la console y est un canal de sortie legitime.
    files: ['database/scripts/**/*.mjs', 'database/seed.ts', '**/*.config.{ts,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },
]

export default config
