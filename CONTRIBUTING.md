# Contributing — SAHED DENTAL CLINIC

Thank you for considering a contribution. This application handles **health
and financial data**, so a few rules are non-negotiable.

## Ground rules

1. **Never point the application, migrations, seeds or tests at a real clinic
   database.** Development and testing use disposable local PostgreSQL
   databases only. Integration tests require an explicit `TEST_DATABASE_URL`
   naming a throwaway database (see `docs/TESTS.md`).
2. **Never commit secrets.** No password, connection string, session secret or
   pepper in source, documentation, screenshots or fixtures. Configuration
   values go in a local `.env` (ignored by Git); `.env.example` files contain
   placeholders only.
3. **Never commit real clinic data** — no patient record, no database dump, no
   backup, no log containing real data.
4. **No fixture or screenshot with real patient information.** Use synthetic
   data (for example the demo seed via `npm run db:seed:demo` against the
   isolated demo database on port 5433).

## Development workflow

```bash
npm install              # dependencies
copy .env.example .env   # then fill in your local values
npm run db:migrate:deploy
npm run db:generate
npm run db:seed
npm run dev              # http://localhost:3000
```

## Before proposing a change

All three must pass with zero errors / zero tolerated warnings:

```bash
npm run typecheck
npm run lint
npm run test
```

Report skipped integration tests honestly: they only run when
`TEST_DATABASE_URL` points at a disposable database.

## Migrations

Migrations are versioned and written for PostgreSQL. Never modify an
already-applied migration: create a new one. A migration must never delete a
column containing medical or financial data without a two-step migration
(add column, migrate data, remove).

See `docs/DEPLOYMENT.md` §4 for the rationale.

## Tests

- Pure business-logic tests live in `tests/business/` and run everywhere.
- Integration tests live in `tests/integration/` and run only against a real
  disposable PostgreSQL (`TEST_DATABASE_URL`).
- A test that does not run is not a pass. Never replace a real integration
  test with a mock to make a report look green.

## Code style

- TypeScript strict; French domain vocabulary is used throughout the codebase
  (keep it consistent with existing naming).
- Prettier config is enforced; run `npm run format` if needed, but keep
  formatting changes out of functional commits.

## Documentation

User-facing behaviour changes should update the relevant document under
`docs/` in the same change.
