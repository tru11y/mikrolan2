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

- [ ] No CGU / privacy policy anywhere in the repo — required before Play Store submission.
- [ ] CI never runs `test:e2e` — only `/api/auth/*` has e2e coverage; nothing for `/admin/config`, invoice validation, or `/subscriptions/payment-info`.
- [ ] `AdminService.validateInvoice`/`rejectInvoice` and `SubscriptionsService.uploadProof` have no unit tests despite being the revenue-critical path.
- [ ] No i18n — all UI strings hardcoded in French.
- [ ] Postgres backup strategy on the VPS not documented in-repo — verify manually.
- [ ] `mail.service.ts` silently no-ops (just a `logger.warn`) if `SMTP_HOST` is unset — confirm it's actually configured in prod.
