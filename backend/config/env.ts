import { z } from 'zod'

/**
 * =============================================================================
 *  VALIDATION DE LA CONFIGURATION (VARIABLES D'ENVIRONNEMENT)
 * =============================================================================
 *
 *  Aucun secret n'est ecrit dans le code source (§6, §38, §41). Toutes les
 *  valeurs sensibles proviennent de l'environnement et sont validees ici, une
 *  fois au demarrage. Une configuration invalide doit faire echouer le
 *  demarrage : demarrer avec un secret par defaut serait un risque de securite
 *  silencieux.
 *
 *  Ce module est SERVEUR uniquement. Il ne doit jamais etre importe dans un
 *  composant client : il lit des secrets.
 */

const isProduction = process.env.NODE_ENV === 'production'

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /** PostgreSQL uniquement : c'est la seule source de verite du systeme. */
    DATABASE_PROVIDER: z.enum(['postgresql']).default('postgresql'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire.'),

    /** 32 octets minimum : un secret court rendrait les jetons previsibles. */
    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET doit faire au moins 32 caracteres.')
      .optional(),

    /** Sel applicatif du hachage Argon2id. Optionnel mais recommande. */
    PASSWORD_PEPPER: z.string().min(16).optional(),

    APP_URL: z.string().url('APP_URL doit etre une URL absolue valide.'),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /** Compte medecin initial — usage unique par le script de seed. */
    DOCTOR_EMAIL: z.string().email().optional(),
    DOCTOR_NAME: z.string().optional(),
    DOCTOR_INITIAL_PASSWORD: z.string().min(12).optional(),

    /** Repertoire PRIVE des documents, hors racine web. */
    DOCUMENTS_STORAGE_PATH: z.string().optional(),
    DOCUMENTS_MAX_BYTES: z
      .string()
      .default('20971520')
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => Number.isFinite(value) && value > 0, {
        message: 'DOCUMENTS_MAX_BYTES doit etre un entier positif.',
      }),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((value, ctx) => {
    // En production, les cookies doivent etre Secure et le secret de session
    // obligatoire. Ces deux erreurs sont les plus dangereuses : elles rendent
    // le systeme exploitable ou les sessions interceptables.
    if (value.NODE_ENV === 'production') {
      if (!value.COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE doit valoir "true" en production (HTTPS obligatoire).',
        })
      }
      if (!value.SESSION_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SESSION_SECRET'],
          message: 'SESSION_SECRET est obligatoire en production.',
        })
      }
    }
  })

export type Env = z.infer<typeof schema>

let cached: Env | null = null

/**
 * Retourne la configuration validee. Le resultat est mis en cache : la
 * validation ne s'execute qu'une fois par processus.
 */
export function getEnv(): Env {
  if (cached) return cached

  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    // Message lisible mais SANS divulguer la valeur fautive (elle peut etre un
    // secret). On nomme la variable, jamais son contenu.
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n')
    throw new Error(
      "Configuration d'environnement invalide. Verification interrompue :\n" + details,
    )
  }

  cached = parsed.data
  return cached
}

/** Raccourci : indique si le code s'execute en production. */
export function isProd(): boolean {
  return getEnv().NODE_ENV === 'production'
}

/** Reinitialise le cache — reserve aux tests. */
export function resetEnvCache(): void {
  cached = null
}

export { isProduction }
