# Security Policy — SAHED DENTAL CLINIC

This application stores **medical and financial data**. Responsible disclosure
is welcome.

## Reporting a vulnerability

Please report vulnerabilities **privately**, using GitHub's private
vulnerability reporting on this repository
(**Security → Report a vulnerability**). Do not open a public issue for a
security problem.

Please include, when possible:

- a description of the issue and its impact;
- the steps to reproduce (a minimal proof of concept is ideal);
- the affected version or commit.

You will receive an acknowledgement, and a fix or mitigation will be
coordinated with you before any public disclosure. Please allow a reasonable
time for a fix before any public communication.

## Scope

In scope:

- authentication and session handling (`backend/auth/`, `src/middleware.ts`);
- authorization on API routes (`src/app/api/**`, `backend/services/**`);
- input validation and injection resistance (`backend/validation/`,
  `backend/domain/`);
- file upload and document access (`backend/services/documents.service.ts`);
- the desktop application's local database lifecycle (`desktop/`).

Out of scope:

- vulnerabilities requiring a compromised local machine or the local
  PostgreSQL socket of a running installation;
- reports about the packaged installer being unsigned (known and documented in
  the README).

## Supported versions

Only the latest release on the default branch is supported.

## Security model

The implemented security model (Argon2id hashing with a server-side pepper,
opaque server-side sessions, CSRF protection, strict CSP, private document
storage) is described in `docs/SECURITY.md`.

## Contributor reminders

- Never commit secrets or real clinic data (see `CONTRIBUTING.md`).
- Never run the application or its scripts against a real clinic database
  while developing or testing.
