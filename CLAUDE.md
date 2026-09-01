# MikroLan – Claude Code Project Guide

## Project Overview

**MikroLan** is a commercial multi-tenant SaaS for onboarding and managing MikroTik routers (hotspot/FAI), with manual mobile money billing (Wave/Orange Money), an admin back-office, and RouterOS remote provisioning.

- **Backend:** NestJS + Fastify + Prisma + PostgreSQL — `backend/`
- **Mobile:** Expo / React Native — `mobile/` (includes the SUPER_ADMIN back-office screens, no separate web frontend)
- **Deploy:** GitHub Actions CI (`.github/workflows/ci.yml`) → SSH deploy to VPS, systemd service `mikrolan-api`

**Scope: `backend/` and `mobile/` only.** The `mikroserver/` submodule is a separate, unrelated fork — never read, explore, or modify it without explicit user permission.

`_legacy/` contains the original Python/FastAPI prototype (main.py, models.py, onboarding.py, routeros_api.py, etc.) and early design docs — superseded by `backend/`, kept for reference only, not deployed anywhere.

## Repository Structure

```
.
├── backend/           # NestJS API (source of truth, deployed to VPS)
├── mobile/             # Expo app (client + SUPER_ADMIN admin screens)
├── mikroserver/        # unrelated submodule — DO NOT TOUCH without explicit permission
├── _legacy/            # archived Python/FastAPI prototype + old docs
├── README.md
└── .github/workflows/ci.yml
```

## Backend (`backend/`)

- NestJS modules under `src/modules/`: `auth`, `admin`, `subscriptions`, `remote-access`, `notifications`, `mail`, `health`, etc.
- Prisma schema: `backend/prisma/schema.prisma` — `Tenant`, `User` (roles incl. `SUPER_ADMIN`), `Subscription`, `SubscriptionTier`, `Invoice`, `PaymentProof`, `PlatformConfig` (key/value app config).
- Payment flow (manual mobile money, no payment API): client uploads a payment proof (`SubscriptionsService.uploadProof`) → SUPER_ADMIN validates in the admin back-office (`AdminService.validateInvoice`) → atomic transaction activates Invoice/Subscription/Tenant.
- Global guards: JWT + `RolesGuard` (`@Roles(UserRole.SUPER_ADMIN)` etc.), Zod validation at every controller boundary, global rate limiting (`ThrottlerModule`), Helmet, CORS restricted via `CORS_ORIGINS`.
- RouterOS credentials stored AES-256-GCM encrypted (`Tenant.credEncrypted`).
- Tests: `npm test` (unit, `*.spec.ts`), `npm run test:e2e` (testcontainers, `test/jest-e2e.json`) — **CI currently only runs unit tests**, e2e must be run manually until wired into `ci.yml`.

## Mobile (`mobile/`)

- Client app + admin back-office (`app/admin.tsx`) in one Expo app, gated by role.
- Payment screen `app/payment.tsx` reads `GET /subscriptions/payment-info` (Wave/Orange Money numbers configured by SUPER_ADMIN via `PlatformConfig`).
- Sentry + `ErrorBoundary` per screen; Android keystore committed at `mobile/android/mikrolan-release.keystore`.
- **Protected native files** (LAN access to MikroTik routers — never touch without explicit consent, see `mobile/CLAUDE.md` for the full list and why): `LanBinderModule.kt`, `MainApplication.kt`, `MainActivity.kt`, `AndroidManifest.xml`, `network_security_config.xml`.

## Development Notes

- All RouterOS operations must be idempotent (check-then-create).
- Failure handling is per-router/per-tenant; one failure doesn't cascade.
- Read a file before modifying it. Understand existing code before suggesting changes.

## Known Gaps (as of last audit)

- [x] ~~No CGU / privacy policy~~ — added at `/api/legal/terms` and `/api/legal/privacy` (PR #19).
- [x] ~~CI never runs `test:e2e`~~ — CI runs e2e tests (auth, payments, revenue, analytics, forecast).
- [x] ~~Revenue-critical path has no unit tests~~ — `upload-proof.spec.ts` and push notification assertions added (PR #17).
- [x] ~~Postgres backup strategy not documented~~ — `pg_backup.sh` with S3 off-site backup to `s3://mikrolan-backups` (PR #19).
- [ ] No i18n — all UI strings hardcoded in French.
- [x] ~~`mail.service.ts` no-ops if `SMTP_HOST` unset~~ — confirmed SMTP configured in prod (Brevo).
