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
      .min(32, 'SESSION_SECRET doit faire au moins 32 caractères.')
      .optional(),

    /** Sel applicatif du hachage Argon2id. Optionnel mais recommande. */
    PASSWORD_PEPPER: z.string().min(16).optional(),

    /**
     * URL publique de l'application. OPTIONNELLE depuis le correctif «
     * preview Vercel » : le déploiement preview n'hérite pas de cette variable
     * (observé en production log — « APP_URL : Required » bloquait TOUTE
     * requête authentifiée, dont login et export PDF). Aucune autre partie du
     * code ne la lit : elle ne sert qu'à détecter un hôte local pour assouplir
     * COOKIE_SECURE (application de bureau). Le site web n'en dépend pas, et
     * la règle « Secure en production » continue d'être appliquée par la
     * superRefine ci-dessous, indépendamment de cette valeur.
     */
    APP_URL: z
      .string()
      .url('APP_URL doit être une URL absolue valide.')
      .optional(),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /** Compte medecin initial — usage unique par le script de seed. */
    DOCTOR_EMAIL: z.string().email().optional(),
    DOCTOR_NAME: z.string().optional(),
    /**
     * Mot de passe INITIAL du medecin (seed uniquement). Le minimum est
     * volontairement plus permissif que le mot de passe definitive : le seed
     * pose la sentinelle `passwordChangedAt = epoch 0` qui FORCE un changement
     * a la premiere connexion. La regle stricte (12+ caracteres) s'applique au
     * NOUVEAU mot de passe (`changementMotDePasseSchema`), pas a la graine
     * temporaire fournie par le cabinet.
     */
    DOCTOR_INITIAL_PASSWORD: z.string().min(8).optional(),

    /** Repertoire PRIVE des documents, hors racine web. */
    DOCUMENTS_STORAGE_PATH: z.string().optional(),
    DOCUMENTS_MAX_BYTES: z
      .string()
      .default('20971520')
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => Number.isFinite(value) && value > 0, {
        message: 'DOCUMENTS_MAX_BYTES doit être un entier positif.',
      }),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((value, ctx) => {
    // En production, les cookies doivent etre Secure et le secret de session
    // obligatoire. Ces deux erreurs sont les plus dangereuses : elles rendent
    // le systeme exploitable ou les sessions interceptables.
    // EXCEPTION : application de bureau — APP_URL pointe sur l'interface locale
    // (127.0.0.1 / localhost) servie en HTTP simple, jamais accessible depuis
    // l'exterieur de la machine. Les cookies Secure seraient ignorés par le
    // navigateur embarqué et rendraient la connexion impossible. Le reste de
    // la machine n'etant pas exposé, le risque est equivalent au mode dev.
    const hoteLocal = (() => {
      // APP_URL est optionnelle (correctif preview Vercel) : si elle est absente,
      // nous ne sommes PAS sur une application de bureau locale (c'est un
      // déploiement web) — le hôte n'est pas local, COOKIE_SECURE doit rester
      // requis en production.
      if (!value.APP_URL) return false
      try {
        const hote = new URL(value.APP_URL).hostname
        return hote === 'localhost' || hote === '127.0.0.1' || hote === '[::1]'
      } catch {
        return false
      }
    })()
    if (value.NODE_ENV === 'production') {
      if (!value.COOKIE_SECURE && !hoteLocal) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message:
            'COOKIE_SECURE doit valoir "true" en production (HTTPS obligatoire), sauf si APP_URL pointe sur la machine locale (application de bureau).',
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
