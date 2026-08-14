# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

iKiot-BE — a NestJS/TypeScript backend for iKiotMS, a multi-tenant retail/inventory management system (products, orders, inventory, staff, payroll, subscriptions/billing). This is the PostgreSQL/Prisma rewrite target of the mature Node/Express + MongoDB backend at `../iKiotMS-BE` — see that project's `CLAUDE.md`/`AGENTS.md` for the business logic and conventions this is migrating *from*. Package manager is pnpm (`pnpm-lock.yaml`).

Data layer and module scaffolding for all 33 top-level entities are in place (see Architecture below); most of the actual business logic (payroll calculators, promotion pricing engine, auth flows, subscription/quota enforcement, etc.) has **not** been ported yet — the generated services are plain CRUD over Prisma. Treat this as infrastructure, not a feature-complete backend.

## Commands

```bash
pnpm install            # install dependencies
pnpm run start:dev      # run with watch mode (primary dev loop)
pnpm run start:debug    # watch mode + --inspect debugger
pnpm run build          # compile to dist/ via nest build
pnpm run start:prod     # run compiled output (node dist/main)
pnpm run lint           # eslint --fix over src/apps/libs/test
pnpm run format         # prettier --write over src/ and test/

pnpm run test                      # unit tests (jest, *.spec.ts, run from src/)
pnpm run test -- app.controller    # run a single unit test file (jest name filter)
pnpm run test:watch                # unit tests in watch mode
pnpm run test:cov                  # unit test coverage
pnpm run test:e2e                  # e2e tests (test/*.e2e-spec.ts, separate jest config at test/jest-e2e.json)

npx prisma format               # format + validate prisma/schema.prisma (no DB needed)
npx prisma generate             # regenerate the Prisma client into generated/prisma after schema changes
npx prisma migrate dev          # create + apply a migration against DATABASE_URL (needs a real Postgres)
npx prisma studio               # browse data in a GUI
```

Unit test config lives inline in `package.json` (`rootDir: src`, matches `*.spec.ts`); e2e tests use `test/jest-e2e.json` and live in `test/`.

## Architecture

### Data layer (Prisma / PostgreSQL)

`prisma/schema.prisma` is the source of truth, converted field-by-field from every Mongoose model in `iKiotMS-BE/src/models/`. Read the schema header comment for the conversion conventions (uuid PKs, snake_case via `@map`/`@@map`, enums kept as `String` rather than native Postgres enums, embedded subdocuments flattened or split into child tables, polymorphic Mongo refs turned into paired nullable FKs). Known deviations from the old Mongo schema, all deliberate:

- **`RefreshToken` was not ported** — refresh tokens are moving to Redis instead of Postgres.
- **`Tenant.workingPolicy`** was dropped (confirmed unused anywhere in the old codebase before removing it).
- **`Brand` and `Category` gained `tenantId`** — the old schema left them global, but `permissions.json` in iKiotMS-BE granted per-tenant roles full CRUD on both, so the missing tenant scoping looked like a gap, not a design choice.
- **The `Paysheet`/`"PaySheet"` ref casing bug is resolved** by using `Paysheet` consistently (the old Mongoose ref string didn't match the registered model name).
- A few uniqueness rules that relied on Mongo's *partial/sparse* indexes (e.g. "one open cash-drawer session per branch") still need a hand-written `CHECK`/partial-index added to the generated SQL migration — Prisma's schema DSL can't express those directly. Search the schema for `follow-up migration` comments.
- **RBAC is not the old fixed 6-role enum + static `permissions.json` anymore** — see "Authorization" below. `User.role` (string enum) was replaced by `User.systemRole` + `User.roleId`, and three new models (`Role`, `RolePermission`, `PermissionCatalog`) were added.

Prisma is configured for **CommonJS** output (`moduleFormat = "cjs"` in the generator block) to match the rest of this Nest project, which is not an ESM package — Prisma 7 defaults to ESM-only client output otherwise. The generated client lives in `generated/prisma` (gitignored, regenerate with `prisma generate`) and is wired into Nest via a global `PrismaModule`/`PrismaService` (`src/prisma/`) that injects a `@prisma/adapter-pg` driver adapter rather than a bare connection string, which Prisma 7 requires for SQL providers.

`.claude/skills/prisma-*` in this repo are the Prisma CLI's own bundled skills (installed by `prisma init`) — check them before guessing at Prisma 7 syntax, since it changed significantly from earlier versions (`prisma.config.ts` instead of a `package.json` block, required driver adapters, new generator).

### Module structure

`src/modules/<name>/` — one NestJS module per top-level Prisma entity (33 total; child/join tables like `order_items` or `paysheet_bonuses` are *not* separate modules, they're meant to be managed as nested writes within their parent entity's service). Each module currently follows the same generated shape:

```
src/modules/<name>/
├── <name>.module.ts
├── <name>.controller.ts     # plain REST CRUD (GET/GET :id/POST/PATCH :id/DELETE :id)
├── <name>.service.ts        # injects PrismaService, one Prisma call per method
└── dto/
    ├── create-<name>.dto.ts   # class-validator, generated from the Prisma schema's scalar fields
    └── update-<name>.dto.ts   # PartialType(Create...Dto)
```

These were generated by `scripts/generate-modules.js`, which parses `prisma/schema.prisma` directly (not hand-written per module) — see that script if the schema changes enough to warrant regenerating. It's a one-off tool, not part of the build; re-running it will overwrite any hand-edits made to generated module files.

**Not yet wired up, in rough priority order for porting business logic from iKiotMS-BE:**
- Every generated CRUD controller (the 33 from the codegen script) is now gated by the global `JwtAuthGuard` (valid token required) but has **no `@Permissions()` decorators yet** — `PermissionsGuard` allows any authenticated user through until each module adds them during its real port. The stale `// TODO: apply guard` comments in those controllers predate this — the guard *is* applied, only the per-route permission declarations are still missing.
- Tenant-scoping enforcement on the generated modules — `findAll` accepts an optional `tenantId` query param but nothing requires/derives it from the authenticated user yet (the hand-built `auth`/`users`/`roles` modules do this correctly; use them as the reference when porting the rest).
- The response envelope (`{ success, message?, data? }`) and matching global exception filter used throughout iKiotMS-BE — controllers currently return raw Prisma results.
- Real business logic (payroll calculation, promotion pricing engine, attendance/schedule rules, subscription quota checks, etc.) — the generated services are intentionally thin CRUD, not ports of the original logic.
- Refresh tokens, Firebase login, OTP-based registration/forgot-password — deferred out of the `auth` module's first pass (see Authorization below). `/auth/login` and `/auth/register` only support password auth for now; there is no `/auth/refresh` or `/auth/logout` yet.

ESLint (`eslint.config.mjs`) uses `typescript-eslint`'s `recommendedTypeChecked` + `eslint-plugin-prettier`; notably `no-explicit-any` is turned off and `no-floating-promises`/`no-unsafe-argument` are warnings, not errors.

### Authorization (RBAC redesign, 2026-08-14)

Deliberately **not** a port of iKiotMS-BE's fixed 6-role enum + static `permissions.json`. `User.systemRole` is a coarse account kind — `ADMIN | TENANT_OWNER | CUSTOMER | STAFF`:

- **`ADMIN`** (platform) and **`TENANT_OWNER`** are fixed and always full-access. Neither is ever a row in the `Role` table — `PermissionsGuard` short-circuits both before checking anything. `User.tenantId` is nullable specifically so `ADMIN` accounts can exist outside any tenant.
- **`CUSTOMER`** is a separate, minimal, fixed-permission account kind (`CUSTOMER_PERMISSIONS` in `src/common/constants/system-role.ts`) — intentionally outside the tenant role-management system.
- **`STAFF`** accounts hold a tenant-owned, tenant-editable `Role` (`User.roleId`), each with a set of `RolePermission` rows (`resource`, `action`). A `TENANT_OWNER` creates roles and toggles permissions per role via the `roles` module (`POST/PATCH/DELETE /roles`, owner/admin-only via `OwnerOrAdminGuard` — deliberately *not* routed through the permission catalog itself, so no custom role, however permissive, can ever grant itself role-management access).
- `RolePermission.(resource, action)` is constrained by a real FK into `PermissionCatalog` — a fixed, code-owned taxonomy seeded from iKiotMS-BE's old `permissions.json` (`prisma/seed.ts`, run via `npx prisma db seed`). Tenants pick from this catalog; they cannot invent new resource/action pairs, since every `@Permissions(resource, action)` guard in code is written against a specific pair. Add new pairs to `prisma/seed.ts` (and re-seed) whenever a newly-ported module needs one that doesn't exist yet.
- Branch/warehouse scope (`User.branchId`/`warehouseId`) stays independent of role — a role decides *what* a STAFF account can do, not *where*.
- **Permissions are re-checked fresh on every request**, not cached in the JWT: `JwtStrategy.validate()` (`src/modules/auth/strategies/jwt.strategy.ts`) re-fetches the user + their role's current permissions from Postgres on each call. This is a deliberate departure from iKiotMS-BE (which trusted role claims baked into the JWT payload) — the entire point of tenant-editable roles is that revoking a permission must take effect immediately, not after the access token expires.
- Route-level usage: `@Permissions('products', 'create')` on a handler; `PermissionsGuard` (registered globally via `APP_GUARD` in `AppModule`, after `JwtAuthGuard`) reads it via `Reflector` and checks `req.user.permissions` (a precomputed `Set<"resource:action">`). No decorator on a route means "any authenticated user" (JwtAuthGuard alone gates it) — `@Public()` opts a route out of auth entirely (used by `/auth/login`, `/auth/register`).
