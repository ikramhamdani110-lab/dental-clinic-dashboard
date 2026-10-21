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
      // Sortie du packager desktop (Next standalone embarque, electron-builder).
      'desktop/resources/**',
      'desktop/dist/**',
      'desktop/ico/**',
      '.local/**',
      '.tmp/**',
      '.preview/**',
      'storage/**',
      'database/prisma/generated/**',
      'database/prisma/local/**',
      'next-env.d.ts',
      // Scripts de QA / audit exécutés à la main hors application : ils ne
      // sont pas livrés et utilisent la console comme canal de sortie.
      'qa/**',
      'audit-*.mjs',
      'qa-*.mjs',
      'tmp-*.mjs',
      'tmp-*.cjs',
      'patch-anim.mjs',
      '.c-diag.mjs',
      'db-check.mjs',
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
    files: [
      'database/scripts/**/*.mjs',
      'database/seed.ts',
      '**/*.config.{ts,mjs}',
      // Scripts Electron / packaging / tests de demarrage (hors application).
      'desktop/*.mjs',
      'desktop/*.cjs',
    ],
    rules: {
      'no-console': 'off',
      // Les scripts d'outillage ne passent pas par le bundler : require()
      // est la forme canonique pour charger des modules CJS embarques.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Le prepareur de ressources embarque des squelettes de code morts :
    // on ignore la regle des variables inutilisees pour ces fichiers.
    files: ['desktop/prepare.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
]

export default config
