import { getEnv } from '@backend/config/env'

/**
 * =============================================================================
 *  JOURNALISATION STRUCTUREE (§36)
 * =============================================================================
 *
 *  Sortie JSON sur une ligne par evenement : exploitable par les outils de
 *  supervision, sans dependance externe.
 *
 *  REGLE DE CONFIDENTIALITE (§24, §38)
 *    Les champs sensibles sont RETIRES avant emission, quelle que soit leur
 *    position dans l'objet journalise. Un mot de passe, une empreinte ou un
 *    jeton de session ne peuvent donc pas fuiter par accident dans les
 *    journaux, meme via une metadonnee ajoutee plus tard.
 *
 *  Les details techniques restent ici — cote serveur — et ne sont jamais
 *  transmis a l'interface.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Noms de champs interdits dans les journaux. Comparaison insensible a la casse. */
const REDACTED_KEYS = new Set(
  [
    'password',
    'motdepasse',
    'passwordhash',
    'password_hash',
    'newpassword',
    'currentpassword',
    'token',
    'tokenhash',
    'sessiontoken',
    'csrftoken',
    'csrftokenhash',
    'authorization',
    'cookie',
    'set-cookie',
    'secret',
    'sessionsecret',
    'passwordpepper',
    'apikey',
    'api_key',
    'databaseurl',
    'database_url',
    'pepper',
  ].map((key) => key.toLowerCase()),
)

export const REDACTED = '[masque]'

/**
 * Retire recursivement les champs sensibles d'une valeur.
 * Exporte pour etre teste directement : c'est une garantie de securite, elle
 * doit etre verifiee automatiquement.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[profondeur-max]'
  if (value === null || value === undefined) return value
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(entry, depth + 1)
    }
    return result
  }
  return value
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const env = (() => {
    try {
      return getEnv()
    } catch {
      // Si la configuration est invalide, la journalisation ne doit pas
      // elle-meme planter : on retombe sur des valeurs sures.
      return { LOG_LEVEL: 'info', NODE_ENV: process.env.NODE_ENV ?? 'development' } as const
    }
  })()

  const threshold = LEVEL_ORDER[(env.LOG_LEVEL as LogLevel) ?? 'info'] ?? LEVEL_ORDER.info
  if (LEVEL_ORDER[level] < threshold) return

  const line = JSON.stringify({
    niveau: level,
    horodatage: new Date().toISOString(),
    message,
    ...(context ? { contexte: redact(context) } : {}),
  })

  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
}
