import { describe, expect, it } from 'vitest'

import { validatePasswordStrength, LONGUEUR_MIN_MOT_DE_PASSE } from '@backend/auth/password'
import { redact, REDACTED } from '@backend/logging/logger'
import { estNumeroDentFdiValide } from '@backend/domain/constants'
import {
  connexionSchema,
  paiementCreationSchema,
  patientCreationSchema,
  reprogrammationSchema,
  versErreursChamps,
} from '@backend/validation/schemas'

/**
 * =============================================================================
 *  SECURITE ET VALIDATION (§6, §24, §33, §38)
 * =============================================================================
 */

describe('Robustesse des mots de passe (§6)', () => {
  it('refuse un mot de passe trop court', () => {
    const problemes = validatePasswordStrength('Ab1')
    expect(problemes.some((p) => p.includes(String(LONGUEUR_MIN_MOT_DE_PASSE)))).toBe(true)
  })

  it('exige une majuscule', () => {
    expect(validatePasswordStrength('motdepasse1long').some((p) => p.includes('majuscule'))).toBe(
      true,
    )
  })

  it('exige une minuscule', () => {
    expect(validatePasswordStrength('MOTDEPASSE1LONG').some((p) => p.includes('minuscule'))).toBe(
      true,
    )
  })

  it('exige un chiffre', () => {
    expect(validatePasswordStrength('MotDePasseLong').some((p) => p.includes('chiffre'))).toBe(true)
  })

  it('refuse un mot de passe courant', () => {
    const problemes = validatePasswordStrength('Motdepasse123')
    expect(problemes.some((p) => p.includes('courant'))).toBe(true)
  })

  it('accepte un mot de passe robuste', () => {
    expect(validatePasswordStrength('Dentiste-Sahed-2025')).toEqual([])
  })

  it('n’accepte ni vide ni une chaine quelconque', () => {
    expect(validatePasswordStrength('a').length).toBeGreaterThan(0)
  })
})

describe('Anonymisation des journaux (§24, §38)', () => {
  it('masque un mot de passe', () => {
    const resultat = redact({ email: 'a@b.dz', password: 'secret' }) as Record<string, unknown>
    expect(resultat.password).toBe(REDACTED)
    expect(resultat.email).toBe('a@b.dz')
  })

  it('masque une empreinte de mot de passe', () => {
    const resultat = redact({ passwordHash: '$argon2id$...' }) as Record<string, unknown>
    expect(resultat.passwordHash).toBe(REDACTED)
  })

  it('masque un secret de session', () => {
    const resultat = redact({ sessionSecret: 'abc123' }) as Record<string, unknown>
    expect(resultat.sessionSecret).toBe(REDACTED)
  })

  it('masque un jeton CSRF', () => {
    const resultat = redact({ csrfToken: 'jeton' }) as Record<string, unknown>
    expect(resultat.csrfToken).toBe(REDACTED)
  })

  it('masque les secrets meme imbriques profondement', () => {
    const resultat = redact({
      entree: { donnees: { utilisateur: { password: 'ultra-secret' } } },
    }) as { entree: { donnees: { utilisateur: { password: string } } } }
    expect(resultat.entree.donnees.utilisateur.password).toBe(REDACTED)
  })

  it('masque les secrets dans un tableau', () => {
    const resultat = redact([{ token: 'x' }, { email: 'ok@ok.dz' }]) as Array<
      Record<string, unknown>
    >
    expect(resultat[0]?.token).toBe(REDACTED)
    expect(resultat[1]?.email).toBe('ok@ok.dz')
  })

  it('la comparaison est insensible a la casse', () => {
    const resultat = redact({ Password: 'x', API_KEY: 'y' }) as Record<string, unknown>
    expect(resultat.Password).toBe(REDACTED)
    expect(resultat.API_KEY).toBe(REDACTED)
  })

  it('ne masque pas les champs legitimes', () => {
    const resultat = redact({ action: 'Paiement ajoute', montantCentimes: 100000 }) as Record<
      string,
      unknown
    >
    expect(resultat.action).toBe('Paiement ajoute')
    expect(resultat.montantCentimes).toBe(100000)
  })
})

describe('Numero de dent FDI (§20)', () => {
  it('accepte une dent permanente valide', () => {
    expect(estNumeroDentFdiValide('36')).toBe(true)
    expect(estNumeroDentFdiValide('11')).toBe(true)
    expect(estNumeroDentFdiValide('48')).toBe(true)
  })

  it('accepte une dent temporaire valide', () => {
    expect(estNumeroDentFdiValide('51')).toBe(true)
    expect(estNumeroDentFdiValide('85')).toBe(true)
  })

  it('refuse un code hors domaine', () => {
    expect(estNumeroDentFdiValide('99')).toBe(false)
    expect(estNumeroDentFdiValide('0')).toBe(false)
    expect(estNumeroDentFdiValide('123')).toBe(false)
    expect(estNumeroDentFdiValide('ab')).toBe(false)
  })
})

describe('Validation des entrees (§33)', () => {
  it('refuse une connexion sans mot de passe', () => {
    const resultat = connexionSchema.safeParse({ email: 'a@b.dz', password: '' })
    expect(resultat.success).toBe(false)
  })

  it('normalise l’email en minuscules', () => {
    const resultat = connexionSchema.safeParse({ email: 'MEDECIN@CABINET.DZ', password: 'x' })
    expect(resultat.success).toBe(true)
    if (resultat.success) expect(resultat.data.email).toBe('medecin@cabinet.dz')
  })

  it('refuse un email invalide', () => {
    expect(connexionSchema.safeParse({ email: 'pas-un-email', password: 'x' }).success).toBe(false)
  })

  it('exige le telephone pour un patient', () => {
    const resultat = patientCreationSchema.safeParse({
      nom: 'Ahmed',
      prenom: 'Ben',
      telephone: '',
    })
    expect(resultat.success).toBe(false)
  })

  it('refuse un telephone trop court', () => {
    const resultat = patientCreationSchema.safeParse({
      nom: 'Ahmed',
      prenom: 'Ben',
      telephone: '123',
    })
    expect(resultat.success).toBe(false)
  })

  it('accepte un patient valide', () => {
    const resultat = patientCreationSchema.safeParse({
      nom: 'Ahmed',
      prenom: 'Ben',
      telephone: '0555 12 34 56',
    })
    expect(resultat.success).toBe(true)
  })

  it('refuse une date de naissance dans le futur', () => {
    const futur = new Date()
    futur.setFullYear(futur.getFullYear() + 5)
    const resultat = patientCreationSchema.safeParse({
      nom: 'Ahmed',
      prenom: 'Ben',
      telephone: '0555123456',
      dateNaissance: futur.toISOString(),
    })
    expect(resultat.success).toBe(false)
  })

  it('refuse un paiement de montant nul ou negatif', () => {
    const base = {
      patientId: '00000000-0000-0000-0000-000000000000',
      treatmentId: '00000000-0000-0000-0000-000000000001',
      datePaiement: new Date().toISOString(),
      methode: 'ESPECES' as const,
      idempotencyKey: 'cle-12345678',
    }
    expect(paiementCreationSchema.safeParse({ ...base, montantCentimes: '0' }).success).toBe(false)
    expect(paiementCreationSchema.safeParse({ ...base, montantCentimes: '-500' }).success).toBe(
      false,
    )
    expect(paiementCreationSchema.safeParse({ ...base, montantCentimes: '15000' }).success).toBe(
      true,
    )
  })

  it('exige une cle d’idempotence (anti double soumission)', () => {
    const resultat = paiementCreationSchema.safeParse({
      patientId: '00000000-0000-0000-0000-000000000000',
      treatmentId: '00000000-0000-0000-0000-000000000001',
      montantCentimes: '15000',
      datePaiement: new Date().toISOString(),
      methode: 'ESPECES',
    })
    expect(resultat.success).toBe(false)
  })

  it('refuse une reprogrammation dont la fin precede le debut', () => {
    const resultat = reprogrammationSchema.safeParse({
      dateDebut: '2025-03-10T14:00:00.000Z',
      dateFin: '2025-03-10T13:00:00.000Z',
    })
    expect(resultat.success).toBe(false)
  })

  it('produit des erreurs de champ francaises', () => {
    const resultat = patientCreationSchema.safeParse({ nom: '', prenom: '', telephone: '' })
    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      const champs = versErreursChamps(resultat.error)
      expect(champs.length).toBeGreaterThan(0)
      expect(champs.every((champ) => champ.message.length > 0)).toBe(true)
      expect(champs.every((champ) => typeof champ.champ === 'string')).toBe(true)
    }
  })
})

describe('Resistance aux injections et au XSS (§38, §43)', () => {
  it('accepte une charge SQL dans un champ texte SANS l’executer (validateur ne casse pas)', () => {
    const resultat = patientCreationSchema.safeParse({
      nom: "Robert'); DROP TABLE patients;--",
      prenom: 'Test',
      telephone: '0555123456',
    })
    // Le validateur accepte la chaine (c'est une donnee), mais Prisma la traitera
    // comme paramètre, jamais comme SQL. Le role du test ici est de prouver que
    // la couche de validation ne casse pas et ne fait pas remonter d'erreur brute.
    expect(resultat.success).toBe(true)
  })

  it('accepte une charge XSS dans un champ texte (elle sera echappee a l’affichage)', () => {
    const resultat = patientCreationSchema.safeParse({
      nom: '<script>alert(1)</script>',
      prenom: 'Test',
      telephone: '0555123456',
    })
    expect(resultat.success).toBe(true)
  })

  it('rejette une valeur d’enum hors domaine', () => {
    const resultat = paiementCreationSchema.safeParse({
      patientId: '00000000-0000-0000-0000-000000000000',
      treatmentId: '00000000-0000-0000-0000-000000000001',
      montantCentimes: '15000',
      datePaiement: new Date().toISOString(),
      methode: 'BITCOIN',
      idempotencyKey: 'cle-12345678',
    })
    expect(resultat.success).toBe(false)
  })
})
