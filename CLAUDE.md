# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

iKiot-BE — a NestJS/TypeScript backend for iKiotMS, a multi-tenant retail/inventory management system (products, orders, inventory, staff, payroll, subscriptions/billing). This is the PostgreSQL/Prisma rewrite target of the mature Node/Express + MongoDB backend at `../iKiotMS-BE` — see that project's `CLAUDE.md`/`AGENTS.md` for the business logic and conventions this is migrating *from*. Package manager is pnpm (`pnpm-lock.yaml`).

Data layer and module scaffolding for all 33 top-level entities are in place (see Architecture below). **Real business logic has been ported for**: auth (`auth`), staff/role management (`users`, `roles`), audit logging (`audit-logs`, now tenant *and* platform scoped), notifications (`notifications`, inbox + fan-out, realtime over Socket.IO), billing (`plans`, `subscriptions`, `subscription-invoices`), org/reference data (`branches`, `warehouses`, `suppliers`, `brands`, `categories`), the catalogue (`products`, `inventories`), stock transfers (`stock-movement-requests`), selling (`orders`, `promotions`, `customers`, `cash-drawer-sessions`, `cash-flows` read-only), shop self-service (`tenant/me`, `uploads`), the whole workforce stack (`holidays`, `shift-templates`, `working-schedules`, `attendances`, `leave-requests`, `payroll-settings`, `paysheets`, `payroll-periods`, `payslips`), support (`tickets`), reporting (`stats`), and the AI assistant (`ai-chat-histories`). **Every module from iKiotMS-BE now has its real business logic ported.** What remains is listed under "Not yet wired up" — FCM push, a handful of follow-up migrations — not whole modules.

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

**`test:e2e` boots the real `AppModule`, so it needs a reachable `DATABASE_URL`** (`docker compose up -d`). `test/smoke.e2e-spec.ts` is the one that actually exercises business logic: it registers a tenant, puts it on a trial, and drives products, inventory, staff and the whole stock-movement state machine against real Postgres, checking stock arithmetic and the supplier ledger by reading the tables back. **It cleans up everything it creates** (see its `cleanup()`), so it is safe to re-run — keep that true if you add to it. The other exception is `test/di-check.e2e-spec.ts`, which only `.compile()`s the DI graph without `.init()` and therefore runs with no database — it is the cheapest way to catch a wiring mistake (an unexported provider, a missing `DiscoveryModule`, a descriptor discovery that finds nothing) that a type-check can't see. Three pieces of the jest config exist only to get that far under jest — don't remove them without re-running the suite:
- `node --experimental-vm-modules` in the script — Prisma 7's generated client `import()`s its WASM query compiler dynamically, which plain CJS jest can't do.
- `moduleNameMapper: {"^(\\.{1,2}/.*)\\.js$": "$1"}` — the generated Prisma client uses ESM-style `./foo.js` specifiers from `.ts` files.
- `moduleNameMapper: {"^jose$": "<rootDir>/jose.stub.js"}` — `jose` is ESM-only and pulled in by `firebase-admin` → `jwks-rsa`; nothing in the tests exercises it. See the comment in `test/jose.stub.js`.

## Coding rules

These are the conventions this codebase is held to, each one written down because it was
broken somewhere and the breakage was silent. The "why" for each lives in the Architecture
section named in brackets. When a rule and an existing file disagree, the file is the thing
to fix.

### Security & correctness

1. **Every new route declares its access.** `@Permissions(resource, action)` for anything a
   STAFF account shouldn't reach, `AdminOnlyGuard` for platform-level resources,
   `@Public()` only where auth genuinely must not apply. **No decorator means "any
   authenticated user"** — that is a decision, so make it deliberately and never by
   omission. Four subscription routes carried no decorator for weeks and let any staff
   account start a paid upgrade. Pair it with `@ApiBearerAuth('bearer')` in the same edit.
   [Authorization, Swagger]
2. **Every `@Permissions` pair must exist in `prisma/seed.ts`'s `CATALOG`.** Nothing in the
   type system catches a typo here — a pair with no catalog row silently becomes
   ADMIN/TENANT_OWNER-only. Run `node scripts/check-permissions.js` after touching either
   side. [Authorization]
3. **Identity is read off `request.user`, never off a param, query or body** — `tenantId`,
   the acting user's id, their role. Use `resolveTenantScope` / `requireTenantId`.
   [Tenant scoping]
4. **A create DTO never accepts a field the server should compute.** Totals, balances,
   soft-delete states, actor ids. The generated CRUD DTOs still violate this (see
   `CreateOrderDto`) — lock each one down as its module gets its real port.
5. **Cross-tenant misses return 404, not 403**, and `update`/`delete` re-check scope with a
   `findFirst` before writing by id. [Tenant scoping]

### One copy of every rule

6. **A business rule lives in exactly one function, and every caller goes through it.**
   Never re-express it at a call site "just for this query" — that is how
   `nextSubscriptionStatus` came to exist as two hand-written copies that had already
   drifted. If a bulk path can't call the shared function directly, load the rows and
   apply it per row rather than rewriting the conditions as a `where`. [Subscription]
7. **Branch and warehouse changes go in `LocationService`**, not in one of the two
   subclasses. Something belongs in a subclass only when it genuinely applies to one of
   them. [Locations]
8. **No status/role string literals.** `UserStatus`, `LocationStatus`, `SystemRole`,
   `SubscriptionStatus`, `PaymentMethod` — and when a new enum-ish column shows up, add a
   constants file rather than inlining the strings a dozen times.
9. **Don't hand-edit a generated module; edit `scripts/generate-modules.js` instead**, or
   add the model to `PORTED_MODELS` if it has stopped being generated code. A fix applied
   only to the output is undone by the next generator run. [Module structure]

### Layering

10. **Services know nothing about HTTP.** No status codes in return values, no `@Res()`,
    no `res.status()` in a controller. Throw the right `HttpException`; use `@HttpCode()`
    when a route needs a fixed status. `handleSepayWebhook` was the one exception and it
    read as a licence to copy the pattern elsewhere.
11. **Never catch a Prisma error inside a service to turn it into a message.** Add the code
    to `AllExceptionsFilter.translatePrismaError` so every module benefits.
    [Bootstrap]
12. **`AuditInterceptor` and `NotificationService` stay generic.** Route-specific text goes
    in the domain's own `*.audit-template.ts` (marked `@AuditTemplate()`, self-registering)
    or `templates/*.templates.ts`. Neither may grow an `if (path.includes(...))` chain.
    [Notification & audit templates]
13. **Prefer self-registration over a central list.** If adding a feature means "also
    remember to add it to this array in `AppModule`", the list is the bug — a forgotten
    entry still compiles and fails quietly. [Audit logging]

### Types

14. **Don't read an untyped object with `as` casts.** Declare the shape once, have the
    producer commit to it (`satisfies`), and narrow at the boundary with one type guard.
    A chain of `x.field as string` means a producer change breaks behaviour instead of the
    build. [Audit logging]
15. **Strip fields with destructure + rest**, not a `delete` loop or `Omit<...>` + cast —
    `no-unused-vars` runs with `ignoreRestSiblings` precisely so this reads cleanly.
16. **Share across Prisma models with a narrow structural interface, not `any`.** Prisma's
    delegates satisfy a hand-written interface as-is (see `LocationDelegate`); prove it
    with the compiler rather than reaching for a cast. [Locations]
17. **Derive union types from the schema where you can** — `QuotaField` is
    ``Extract<keyof Subscription, `quotaSnapshot${string}`>``, so a new column is usable
    without editing a list. [Subscription]
18. **`PartialType` comes from `@nestjs/swagger`, never `@nestjs/mapped-types`.** Both
    validate identically; only the first one is visible to the Swagger plugin, so the
    wrong import silently empties the docs for that endpoint. [Swagger]

### Queries

19. **No query inside a loop.** Collect the ids, do one `findMany`, index it in a `Map`.
    Walking a parent chain one level at a time counts too — load the set once and walk it
    in memory.
20. **Anything a request needs repeatedly gets fetched once.** A tenant's category forest,
    the owners of a batch of tenants: one round trip, then work in memory.

### Small things that bite

21. **Date arithmetic that produces a day count runs between midnights** (`wholeDaysBetween`,
    `startOfDayUTC`). Dividing a raw millisecond gap makes the answer depend on the hour
    the request arrived, and the test flaky. [Subscription]
22. **A limit of `0` is a limit of zero.** Unlimited is `null` or negative. Don't collapse
    falsy values into "no limit". [Subscription]
23. **Comments explain the decision, not the code.** Every non-obvious choice in this
    codebase carries a note saying what the old system did and why this differs — keep
    that up when you change the decision, and delete the note when it stops being true.

### Before you call it done

24. `npx tsc --noEmit` · `pnpm run lint` · `pnpm run build` · `pnpm run test` ·
    `node scripts/check-permissions.js` if decorators or the seed changed ·
    `pnpm run test:e2e` (needs `docker compose up -d`).
25. **Update `CLAUDE.md` in the same change** when a decision changes the architecture, and
    **append a dated entry to `HANDOFF.md`** (Vietnamese, never rewrite past entries).
    Say plainly what you could not verify.

## Architecture

### Data layer (Prisma / PostgreSQL)

`prisma/schema.prisma` is the source of truth, converted field-by-field from every Mongoose model in `iKiotMS-BE/src/models/`. Read the schema header comment for the conversion conventions (uuid PKs, snake_case via `@map`/`@@map`, enums kept as `String` rather than native Postgres enums, embedded subdocuments flattened or split into child tables, polymorphic Mongo refs turned into paired nullable FKs). Known deviations from the old Mongo schema, all deliberate:

- **`RefreshToken` was not ported** — refresh tokens are moving to Redis instead of Postgres.
- **`Tenant.workingPolicy`** was dropped (confirmed unused anywhere in the old codebase before removing it).
- **`Brand` and `Category` gained `tenantId`** — the old schema left them global, but `permissions.json` in iKiotMS-BE granted per-tenant roles full CRUD on both, so the missing tenant scoping looked like a gap, not a design choice.
- **The `Paysheet`/`"PaySheet"` ref casing bug is resolved** by using `Paysheet` consistently (the old Mongoose ref string didn't match the registered model name).
- A few uniqueness rules that relied on Mongo's *partial/sparse* indexes still need a hand-written `CHECK`/partial-index added to the generated SQL migration — Prisma's schema DSL can't express those directly. Search the schema for `follow-up migration` comments. **"One open cash-drawer session per branch" is done** (`20260826060000_cash_drawer_single_open_session`) and is the worked example: the plain `@@unique` the init migration shipped applied to CLOSED rows too, capping a branch at one closed session for all time — the second day's finalize would have failed. The `@@unique` is gone from the schema and the partial index lives in SQL only, so a future `prisma migrate dev` will propose dropping it; edit that migration rather than applying it.
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
    └── update-<name>.dto.ts   # PartialType(Create...Dto) — from @nestjs/swagger, never @nestjs/mapped-types
```

These were generated by `scripts/generate-modules.js`, which parses `prisma/schema.prisma` directly (not hand-written per module) — see that script if the schema changes enough to warrant regenerating. It's a maintained tool but not part of the build: **re-running it overwrites every file it generates**, so fold changes into its templates rather than hand-editing a still-generated module. Models already ported by hand are listed in `PORTED_MODELS` and skipped; add a model there the moment its module stops being generated code, or the next run will destroy the real implementation.

**Not yet wired up, in rough priority order for porting business logic from iKiotMS-BE** (per the "Thứ tự build đề xuất" in the Feature Ledger artifact — remaining groups: Ticket/Stats/AI, then the deferred HR set — PayrollSetting/Paysheet/ShiftTemplate/Holiday and Schedule/Attendance/LeaveRequest, which the owner asked to leave for later):
- The still-generated CRUD controllers are fully gated now (auth + tenant scope + `@Permissions()`); what they still lack is the **real business logic** — the services under them are one Prisma call per method, so payroll totals, promotion pricing, inventory quotas and the like don't exist yet. The route surface is also plain CRUD, not the old system's richer endpoints (`/orders/:id/pay-offline`, `/leave-requests/:id/approve`, ...), which is why so many catalog actions are still unused (run `node scripts/check-permissions.js` to list them).
- Real business logic for every module past the ones listed above (payroll calculation, promotion pricing engine, attendance/schedule rules, order totals, etc.) — the generated services are intentionally thin CRUD, not ports of the original logic.
- Push (FCM) notification delivery — `NotificationService.notify()` writes the row and emits over Socket.IO now (see "Realtime" below) but still has no push leg; `UserFcmToken` rows are collected (`POST /notifications/device-token`) but nothing sends to them yet.

ESLint has one scoped override: the `no-unsafe-*` family is off for `test/**/*.e2e-spec.ts`, because a supertest response body is `any` by construction and asserting on it is the whole job — source code keeps all of those rules. Otherwise ESLint (`eslint.config.mjs`) uses `typescript-eslint`'s `recommendedTypeChecked` + `eslint-plugin-prettier`; notably `no-explicit-any` is turned off, `no-floating-promises`/`no-unsafe-argument` are warnings, not errors, and `no-unused-vars` runs with `ignoreRestSiblings: true` — "destructure the fields to drop, spread the rest" is the idiom this codebase uses to strip columns off a row (`withNestedAttendanceLocation`, `AuthService.toPublicUser`), and it doesn't compile cleanly without that option.

### Bootstrap (`src/main.ts`)

In order: `trust proxy`, helmet, CORS, `ValidationPipe`, `AllExceptionsFilter`, Swagger, listen.

- **`app.set('trust proxy', …)`** is read from `TRUST_PROXY` (number of proxy hops; unset = no proxy). It has to be set before `request.ip` means anything behind nginx/Cloudflare — and `AuditInterceptor` records `request.ip`, so without it the audit trail's IP column is whatever the client typed into `X-Forwarded-For`.
- **helmet** is configured with the Swagger-compatible CSP directives from Nest's own recipe; the stock CSP blocks `/docs` outright.
- **CORS** origins come from `CORS_ORIGIN` (comma-separated). Unset allows any origin — fine locally, never in production.
- **`AllExceptionsFilter`** (`src/common/filters/all-exceptions.filter.ts`, also registered via `APP_FILTER`) passes `HttpException`s through untouched — the ValidationPipe's `{ statusCode, message: string[], error }` body is what the frontend parses — and translates Prisma errors into real status codes (`P2002` → 409, `P2003`/`P2000`/`P2011`/`P2014` → 400, `P2025` → 404). Anything else is logged with its stack and answered with a generic 500, so an internal message never leaks. Add a code to `translatePrismaError` rather than catching Prisma errors inside a service.

### Swagger (API docs)

Served at `/docs` once the server is running (`main.ts`). Uses the `@nestjs/swagger` CLI plugin (`nest-cli.json` → `compilerOptions.plugins`), which auto-infers `@ApiProperty()` on every DTO from its existing `class-validator` decorators and TS types — **this only runs through `nest build`/`nest start`, not plain `tsc`**, so verify docs by running the dev server and checking `/docs`, not just a type-check. Every controller has `@ApiTags('<route>')`; the hand-ported modules (`auth`, `roles`, `users`, `branches`, `warehouses`, `suppliers`, `brands`, `categories`, ...) additionally use `@ApiBearerAuth('bearer')` (the bearer scheme is registered under the name `'bearer'` in `main.ts`'s `DocumentBuilder` — reuse that exact name, don't invent a new one per module).

**Rule — keep Swagger in lockstep with the real API, in the same change, every time:**
- New controller → add `@ApiTags('<route>')` on the class immediately; add `@ApiBearerAuth('bearer')` (class- or method-level) the moment the route stops being `@Public()`.
- New/changed DTO field → the CLI plugin infers it from `class-validator` decorators automatically in most cases; only hand-add `@ApiProperty()` when the plugin can't express what's needed (an `example`, a `description`, an enum of literal values, etc.) — don't add it redundantly when the plugin already covers it.
- Changed route, removed field, or changed auth/permission requirement → re-check `/docs` after the change. The plugin regenerates docs from source every build, so it won't show *stale* info, but a guard/permission change (e.g. adding `@Permissions()`) has no visible effect in Swagger UI unless paired with the matching `@Api*Auth()` decorator — those two are declared independently and will not silently stay in sync with each other.
- Never leave a controller newly ported from iKiotMS-BE without `@ApiTags()` — every module in "Not yet wired up" above still needs this the moment its real port begins, not deferred to a cleanup pass.

### Authorization (RBAC redesign, 2026-08-14)

Deliberately **not** a port of iKiotMS-BE's fixed 6-role enum + static `permissions.json`. `User.systemRole` is a coarse account kind — `ADMIN | TENANT_OWNER | CUSTOMER | STAFF`:

- **`ADMIN`** (platform) and **`TENANT_OWNER`** are fixed and always full-access. Neither is ever a row in the `Role` table — `PermissionsGuard` short-circuits both before checking anything. `User.tenantId` is nullable specifically so `ADMIN` accounts can exist outside any tenant.
- **`CUSTOMER`** is a separate, minimal, fixed-permission account kind (`CUSTOMER_PERMISSIONS` in `src/common/constants/system-role.ts`) — intentionally outside the tenant role-management system.
- Account lifecycle values live in `src/common/constants/user-status.ts` (`UserStatus`, `INACTIVE_USER_STATUSES`, `SETTABLE_USER_STATUSES`) — use them rather than writing `'ACTIVE'`/`'DELETED'` inline. `INACTIVE_USER_STATUSES` is checked both by `AuthService` at login and by `JwtStrategy` on every subsequent request, which is the point of it being one set: suspending an account must lock out the session already running, not just the next login.
- **`STAFF`** accounts hold a tenant-owned, tenant-editable `Role` (`User.roleId`), each with a set of `RolePermission` rows (`resource`, `action`). A `TENANT_OWNER` creates roles and toggles permissions per role via the `roles` module (`POST/PATCH/DELETE /roles`, owner/admin-only via `OwnerOrAdminGuard` — deliberately *not* routed through the permission catalog itself, so no custom role, however permissive, can ever grant itself role-management access).
- `RolePermission.(resource, action)` is constrained by a real FK into `PermissionCatalog` — a fixed, code-owned taxonomy (`prisma/seed.ts`, run via `npx prisma db seed`; 150 pairs across 30 resources). Tenants pick from this catalog; they cannot invent new resource/action pairs, since every `@Permissions(resource, action)` guard in code is written against a specific pair. Add new pairs to `prisma/seed.ts` (and re-seed) whenever a newly-ported module needs one that doesn't exist yet. It started as iKiotMS-BE's `permissions.json` but is no longer a straight copy: four resources (`customers`, `tickets`, `cash_flows`, `ai_chat`) and a scattering of actions were added because **the old system declared those permissions but never enforced them on the routes** — `/customers`, `/tickets` and `/products` all ran on bare `verifyJwt` with no `authorize()` call, so any logged-in user could reach them. Each addition is commented where it sits in `CATALOG`.
- Branch/warehouse scope (`User.branchId`/`warehouseId`) stays independent of role — a role decides *what* a STAFF account can do, not *where*.
- **Permissions are re-checked fresh on every request**, not cached in the JWT: `JwtStrategy.validate()` (`src/modules/auth/strategies/jwt.strategy.ts`) re-fetches the user + their role's current permissions from Postgres on each call. This is a deliberate departure from iKiotMS-BE (which trusted role claims baked into the JWT payload) — the entire point of tenant-editable roles is that revoking a permission must take effect immediately, not after the access token expires.
- **More than one action means "any of them"**: `@Permissions('orders', 'update', 'pay_offline')` passes on either, matching iKiotMS-BE's `authorize(module, [a, b])` (which resolved with `.some()`). Only used where the old system used it — requiring just the narrower action would lock out roles that already worked. `scripts/check-permissions.js` still requires **every** listed action to exist in the catalog.
- **`can(user, resource, action)`** (`src/common/utils/permission.ts`) is the same rule as a service-level call, for decisions a guard can't make: `GET /orders` needs `orders:read` to be reached at all, but *what it returns* widens to every branch only for someone who also holds `orders:view_all`. Use it rather than reading `user.permissions` directly — ADMIN/TENANT_OWNER have an empty set and would be denied everything.
- Route-level usage: `@Permissions('products', 'create')` on a handler; `PermissionsGuard` (registered globally via `APP_GUARD` in `AppModule`, after `JwtAuthGuard`) reads it via `Reflector` and checks `req.user.permissions` (a precomputed `Set<"resource:action">`). No decorator on a route means "any authenticated user" (JwtAuthGuard alone gates it) — `@Public()` opts a route out of auth entirely (used by `/auth/login`, `/auth/register`, `/auth/send-otp`, `/auth/firebase-login`, and `GET /`, the healthcheck in `app.controller.ts`).
- **Every `@Permissions(resource, action)` pair must exist in the catalog** — `RolePermission` has a real FK into `PermissionCatalog`, so a pair with no catalog row can never be granted to any role, silently turning that route into ADMIN/TENANT_OWNER-only. Nothing in the type system catches this, so `node scripts/check-permissions.js` cross-checks the two; run it after touching either a controller's decorators or the seed's `CATALOG`. It also prints catalog pairs no route uses yet, which is expected while modules are unported.
- Which resource each generated module maps to lives in `RESOURCE` in `scripts/generate-modules.js` (the generator refuses to run for a model missing an entry). Some modules deliberately share a resource — product variants under `products`, shift templates under `schedules`, promotion logs under `promotions` — rather than each getting its own.
- **`@Permissions()` is no protection from a TENANT_OWNER**, who short-circuits the guard entirely. Platform-level resources need `AdminOnlyGuard` instead, the way `/admin/plans` and `/admin/audit-logs` do. **`/tenants` now carries it** (2026-08-26): `Tenant` is the one model with no `tenantId` of its own, so nothing scopes those routes, and `@Permissions('tenants', …)` alone let any shop owner list, edit and delete every other tenant on the platform — and read their SePay webhook key with it. Global guards run before controller-scoped ones, so `request.user` is already populated when it runs. Any future platform-level module needs the same treatment; `@Permissions` on its own is not a gate there.
- **`Tenant.bankingSepayWebhookApiKey` is never returned.** `TenantService` selects an explicit column list that omits it (`TENANT_SELECT`) — Prisma has no `select: false` the way the old Mongoose schema did, so the field the old system deliberately hid came back by default the moment the model was ported. It is more than a password: `SepayOrderService` identifies which tenant a payment webhook belongs to *by* the key. Writing it stays possible through the (admin-only) `/tenants` routes, which is the equivalent of iKiotMS-BE's SUPER_ADMIN-only `PUT /tenant/:tenantId/sepay-key`. List the safe columns, never blacklist the secret one — a column added later should be invisible until someone opts it in.

**Seed data** (`prisma/seed.ts`, run via `npx prisma db seed`): besides the `PermissionCatalog`, also seeds one dev `ADMIN` account — phone `0000000000`, password `password123`, `tenantId: null`. Idempotent (find-then-create, re-running the seed won't duplicate it or touch an existing one) — **change this password before any non-local deployment**, it's a fixed, publicly-known dev credential.

**OTP + Firebase login** (`src/modules/auth/{otp,esms,firebase}.service.ts`) — ported from iKiotMS-BE's `src/services/{otpService,esmsService}.js` and `src/config/firebase.js`, same behavior:
- `OtpService` generates a 6-digit code, stores it **in-memory only** (`Map`, 5 min TTL) — no Redis yet, same caveat as refresh tokens (won't survive a restart, won't work across multiple instances; revisit together). `NODE_ENV !== 'production'` allows a dev bypass via `DEV_OTP_BYPASS_TOKEN` (defaults to the literal `DEV_BYPASS`), or an empty code.
- `EsmsService` sends via the real eSMS API only when `ESMS_API_KEY`/`ESMS_SECRET_KEY` are set; otherwise (any non-production env) `OtpService` logs the code to the server console instead — same graceful-degrade as the old system, don't require ESMS to be configured for local dev to work.
- `FirebaseService` lazy-initializes `firebase-admin` from `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`; `/auth/firebase-login` throws a clean 401 ("chưa được cấu hình") rather than crashing when those are unset. Matches by email only — **no auto-provisioning**, the `User.email` must already exist. It looks the address up as `toLowerCase().trim()`, which is why every DTO that writes `User.email` uses `@NormalizeEmail()` (`src/common/decorators/normalize-email.decorator.ts`) rather than a bare `@IsEmail()`: `register`, `PATCH /auth/me`, `POST /users`, `PATCH /users/:id`. iKiotMS-BE normalized on the way in and the first NestJS pass dropped it, so an account saved as `Foo@Bar.com` could never sign in with Google and the "is this email taken" check missed a row differing only in case. Contact-only addresses (a supplier's, a branch's) deliberately keep the plain `@IsEmail()` — nothing looks an account up by them. **Rows written before 2026-08-26 may still hold mixed-case addresses**; a one-off `UPDATE users SET email = lower(email)` is owed before relying on this. `platform: 'mobile'` gates to `systemRole === STAFF`; anything else (default `'web'`) allows every account kind except `CUSTOMER` — the direct equivalent of iKiotMS-BE's `STAFF_ROLES` gate now that `BRANCH_MANAGER`/`WAREHOUSE_MANAGER`/`STAFF` have collapsed into one `STAFF` systemRole with a custom `Role`.

### Sessions (Redis)

`RedisService` (`src/common/redis/`, global module) is the one connection; `docker compose up -d redis` runs it locally and `REDIS_URL` points at it. **Redis being down is never fatal** — `isReady()` is false, every read answers "not found", and the app keeps serving. That is ported from `src/config/redis.js`, which degraded the same way, and it is a deliberate trade: a shop being unable to log in because a cache is down would be worse than the failure it prevents.

- **`RefreshTokenService`** (`src/modules/auth/`) replaces iKiotMS-BE's Mongo `RefreshToken` collection. A row per token became a key per token (`refresh:<userId>:<jti>`), Redis' key expiry replaces the TTL index, and *deleting* the key replaces `isRevoked: true` — there is no reason to keep a tombstone for a token that can no longer be used. `revokeAllFor(userId)` is a SCAN over `refresh:<userId>:*`, standing in for `updateMany({ userId })`.
- **The signed refresh JWT carries nothing but `sub`, a random `jti` and `type: 'refresh'`.** The session's real state is the Redis key, so a token whose key is gone is not a session whatever its signature says. That is what makes logout and revocation take effect immediately instead of waiting out an expiry.
- **Rotation on every refresh**, ported from `refreshAccessToken`: the presented token is deleted and a new one issued, so a replay (a stolen copy, a buggy client) fails rather than working twice.
- **Changing or resetting a password revokes every session**, as the old system did. The access token already in hand stays valid until it expires — only refreshing is blocked. That was true of the old system too.
- **`/auth/refresh` re-checks the account**, which the old version didn't: a token minted before an account was suspended must not survive the suspension, and `JwtStrategy`'s check only covers access tokens.
- **`OtpService` stores codes in Redis** with the in-memory fallback the old file carried. The fallback is what keeps local dev working without a container and is explicitly not multi-instance safe — old behaviour, kept deliberately. Keys are `normalizePhone`d (`src/common/utils/phone.ts`); the first port keyed on the raw string, so a code requested as `0912345678` wouldn't verify when the confirm step sent `+84912345678`.
- `REDIS_URL` in `.env` is the **local** container. The deployed value (Render) sits commented above it — don't point a test run at that one, it is shared.

### Shop settings vs. tenant administration

Two controllers over the same model, and the split is the security boundary:

- **`/tenant/*`** (`TenantSelfController` + `TenantSelfService`) is a shop's own record — `GET|PUT /tenant/me`, `PUT /tenant/banking`, ported from iKiotMS-BE. The tenant id always comes from `requireTenantId(user)`, so no route here can be pointed at another shop.
- **`/tenants`** (plural, `TenantController`) is platform-admin CRUD over every shop, behind `AdminOnlyGuard`.
- `TENANT_SELECT` (`tenant-select.ts`) is shared by both so they cannot disagree about what is safe to return. `GET /tenant/me` answers `hasSepayKey: boolean` rather than the key — the old `getTenant` did exactly this.
- **`PUT /tenant/banking` is what makes SePay order payments usable.** `OrderService.requireBanking` refuses a SEPAY sale until the account is set, and until this was ported there was no way to set it short of writing to the database by hand.
- Two fixes to the old behaviour, both confirmed before changing: **`PUT /tenant/:tenantId/sepay-key` is `AdminOnlyGuard`-gated** (the old route claimed SUPER_ADMIN in a comment but carried only `authorize('tenants','update')` and read the tenant id unscoped from the path, so any account with that permission could write *any* shop's webhook key — the thing that identifies a tenant to the payment webhook); and **`status` is not settable through `PUT /tenant/me`** (the old handler passed the body straight through, so a SUSPENDED shop could set itself back to ACTIVE).
- **`NotificationService.notifySystem()`** ports `systemNotificationService.js`: a `Notification` row with `tenantId` *and* `recipientId` null — that pair of nulls is what makes a row a system notification — broadcast to the `admin` room. The copy lives in `templates/tenant.templates.ts`, like every other domain's.

### Tenant scoping — never take identity from the client

**Anything the authenticated user already implies is read off `request.user`, never from a param, query string, or request body.** That means `tenantId`, the acting user's id, and their role. `JwtStrategy` re-fetches all of it from Postgres on every request, so the server always holds the authoritative value — asking the client for it again is both redundant and forgeable.

`src/common/utils/tenant-scope.ts` is the one place that decides which tenant a request touches:
- `resolveTenantScope(user, requested?)` → `string | undefined`, for **reads**. Non-ADMIN callers always get their own `tenantId`, and sending someone else's is a `403`. `undefined` comes back only for an ADMIN who named no tenant, and means "every tenant" — pass it into a `where` that drops the filter when undefined.
- `requireTenantId(user, requested?)` → `string`, for **writes**. Same rules, but "every tenant" isn't a valid answer, so an ADMIN with no tenant named gets a `400`.

ADMIN is the only account kind with `User.tenantId === null`, so it is the only one that may name a tenant explicitly. On the generated CRUD routes that override is the optional `?tenantId=` query param; the hand-ported tenant modules (`users`, `roles`, ...) expose no override at all.

Two consequences worth knowing when writing a new module:
- **Cross-tenant access returns `404`, never `403`** — a row in another tenant must be indistinguishable from one that doesn't exist. The generated services do this with `findFirst` + an explicit `NotFoundException` rather than Prisma's `findFirstOrThrow`, whose error isn't an `HttpException` and would surface as a `500`.
- **`update`/`delete` re-check scope via `findOne` first.** Prisma's `update({ where: { id } })` can't take a non-unique tenant filter, so scoping by id alone would let any tenant write any row.

Fields naming the *actor* of a write (`createdById`, and `userId` where it means "who did this") are filled from `user.userId` in the service and dropped from the create DTO — see `ACTOR_FIELD` in `scripts/generate-modules.js`. Careful: on `Attendance` and `Payslip` the field named `userId` means "which employee this row is about", which a manager legitimately sets for someone else, so those stay ordinary body fields. Check the old controller in `iKiotMS-BE` before assuming a `userId` is the actor.

### Realtime (Socket.IO)

`RealtimeGateway` (`src/common/realtime/`, global module) ports iKiotMS-BE's `socketService.js` with one deliberate security fix: the old version let any connected client `emit('join', room)` for **any** room string, including `admin` — meaning any socket could eavesdrop on admin broadcasts just by guessing the name. Here there is no client-driven `join` event at all; `handleConnection` verifies the JWT from `socket.handshake.auth.token` (or an `Authorization` header) and the server itself joins the socket to `user:<id>`, `tenant:<id>` (if any), and `admin` (if `systemRole === ADMIN`) — a client can never end up in a room it doesn't belong to. `emitToRoom(room, event, payload)` is the one primitive every other service should call; never reach into `@WebSocketServer() server` directly outside the gateway itself.

### Audit logging

`AuditInterceptor` (`src/common/interceptors/audit.interceptor.ts`, registered globally via `APP_INTERCEPTOR`) ports iKiotMS-BE's `auditMiddleware.js` — same trigger conditions (mutating methods only, skips `/webhook`/`/uploads`/non-login `/auth` paths). Two deliberate differences from the old version:
- **Every actor except `CUSTOMER` is now audited, not just `ADMIN`/`SUPER_ADMIN`.** iKiotMS-BE only ever logged platform-admin actions; this app also gives each tenant its own trail via `GET /audit-logs` (`audit-logs` module, `OwnerOrAdminGuard`, scoped to the caller's `tenantId`) alongside the unscoped `GET /admin/audit-logs` (`AdminOnlyGuard`). Same filter/pagination shape either way (`user`, `action`, `resource`, `startDate`/`endDate`, `page`/`limit`).
- **Route-specific description logic no longer lives in the interceptor.** `AuditInterceptor` only holds the generic mechanism (actor resolution, IP capture, generic `Tạo mới/Cập nhật/Xóa <Resource>` fallback) plus the `AuditDescriptor[]` (`src/common/audit/audit-descriptor.ts`) it checks first. Each domain module that needs a friendlier description implements its own `*.audit-template.ts` (e.g. `src/modules/subscriptions/subscription.audit-template.ts` for `/subscription/upgrade/:tenantId`), marks the class `@AuditTemplate()`, and registers it as an ordinary provider in its own module. **There is no central list to update** — `AuditInterceptor.onModuleInit()` discovers every `@AuditTemplate()` provider via Nest's `DiscoveryService` (hence `DiscoveryModule` in `AppModule`'s imports). `test/di-check.e2e-spec.ts` asserts discovery actually finds them, because a descriptor that silently isn't found just falls back to the generic description rather than failing.
- **The actor of a login is read off a typed response.** `/auth/login` and `/auth/firebase-login` are `@Public()`, so `request.user` is empty and the interceptor identifies the actor from the response body. `AuthService` declares that shape with `satisfies AuditableLoginResponse` (`src/common/types/login-response.type.ts`), so changing the login response breaks the build instead of quietly writing blank audit rows.

It also infers "did the request succeed" from whether the handler's observable emitted a value, not a real HTTP status code (exact, since every failure path here throws an `HttpException`, which makes the observable error instead of emit). There is still no create/update/delete for `AuditLog` — rows are only ever written by the interceptor.

### Notification & audit templates — no god services

**Rule: `NotificationService` and `AuditInterceptor` must never contain another module's business text or route-specific logic.** Both are delivery/recording *mechanisms* — what a notification says, and how a specific route's audit entry reads, belongs to the domain module that owns that event, in a dedicated file:
- Notification copy → `src/modules/notifications/templates/<domain>.templates.ts`, exporting typed functions returning `NotificationContent` (`{ type, title, description, link? }`). See `subscription.templates.ts` for the shape. The calling service spreads the template into `notify()`: `this.notifications.notify({ tenantId, recipientIds, referenceId, ...SomeTemplates.someEvent(args) })` — never writes `title`/`description` inline.
- Audit descriptions → `src/modules/<domain>/<domain>.audit-template.ts`, a class implementing `AuditDescriptor` (`matches(path)` + `describe(ctx)`), decorated `@AuditTemplate()` and provided by its own module. See `subscription.audit-template.ts`.

Why this matters: both `NotificationService.notify()` and `AuditInterceptor.describe()` are called from every domain in the app. The moment one of them accumulates a growing `if (path.includes('/some-new-route'))` chain or a wall of hardcoded Vietnamese strings for every event type, it becomes a god object that every unrelated PR has to touch and understand. Keep them thin dispatchers; put growth in the domain's own template file instead.

### Subscription & billing

Real port of iKiotMS-BE's `SubscriptionService`/`SubscriptionController`, split across three Nest modules that share one Prisma-backed data layer (`plans`, `subscriptions`, `subscription-invoices`) — same as the old system covered `Plan`/`Subscription`/`SubscriptionInvoice` from one service, since `activateAfterPayment` writes to two of the three tables in one transaction.

Inside the `subscriptions` module the work is split in two, and the split is worth keeping:
- **`SubscriptionService`** owns *state* — free trial, `settleSubscription`, `checkTrialStatus`, `requireActiveSubscription`, `assertQuota`, `adminUpgradePlan`. Depends on Prisma alone, and is the only thing other modules import.
- **`SubscriptionBillingService`** owns *getting paid* — `initiateUpgrade`, `initiateRenewal`, `createPlanInvoice`, `activateAfterPayment`, `handleSepayWebhook`. Nothing in it reads a quota; nothing in the other raises an invoice.

- **`plans`**: `GET /plans` (public, active only) and `GET/PUT/PATCH /admin/plans...` (`AdminOnlyGuard`). No create/delete endpoint — matches the old system exactly, plans are seeded/managed directly against the database (`prisma/seed.ts`).
- **`subscriptions`**: `/subscription/free-trial`, `/subscription/status`, `/subscription/upgrade/initiate`, `/subscription/renew/initiate` — all four carry `@Permissions('subscriptions', 'manage'|'read')`, because they spend the tenant's money and must **not** be open to every authenticated account (they carried no permission at all until 2026-08-20). Plus `/subscription/upgrade/:tenantId` (admin-only, no payment) and `POST /webhook/sepay`. All ported field-for-field from the old `SubscriptionService`/`_createPlanInvoice`/`activateAfterPayment`. The webhook answers a flat HTTP 200 for every outcome — `@HttpCode(200)` on the route, every internal failure caught and reported in the body — so SePay never retries into our bugs; a bad API key is the one exception and throws a real 401.
- **`SepaySubscriptionService`** (`src/modules/subscriptions/sepay-subscription.service.ts`) is the **subscription-only** half of iKiotMS-BE's `sepayService.js` (`IKMS` prefix, iKiot's own company bank account via `SEPAY_ACCOUNT_*` env vars). It is deliberately a separate service from order payments (`ORD` prefix, each tenant's own `banking.*` fields) — don't merge them when orders get ported, they're structurally different integrations that happen to share a webhook-signature pattern.
- **`SubscriptionCronService`** (`@nestjs/schedule`, `EVERY_DAY_AT_2AM`, skipped when `NODE_ENV=test`) ports `src/jobs/subscriptionJob.js` — batch status-transition sweep, then expiry-reminder notifications+emails at `REMINDER_DAYS=[7,3,1]` days out. `ScheduleModule.forRoot()` is registered once in `AppModule`. It loads the candidates and applies `nextSubscriptionStatus` per row rather than re-expressing the rules as `updateMany` filters, and looks the tenant owners up in one batched query rather than one per subscription.
- One intentional behavior fix vs. the old code: `activateAfterPayment`'s webhook-triggered history-log entry now sets `changedById: null` instead of iKiotMS-BE's `changedById: <tenantId>` (a tenant ID in a "changed by user" field read as a bug, not a feature — there's no acting user for an automated payment event).
- `src/common/utils/reference-generator.ts` (`generateReference`, `REFERENCE_PREFIX`) is shared, reusable infrastructure ported from `referenceGenerator.js`/`referencePrefix.js` — reuse it (don't reinvent) when Order/Supplier/Payroll reference codes get ported.
- **The expiry rules live in exactly one function**: `nextSubscriptionStatus(subscription, now)` in `src/modules/subscriptions/subscription-status.ts`, unit-tested in `subscription-status.spec.ts`. Two callers apply it — `SubscriptionService.settleSubscription()` lazily on every read (so a tenant is never served on a term that ran out an hour ago) and `SubscriptionCronService` nightly. **Never re-implement those transitions at a call site**; they used to exist as two hand-written copies and had already drifted (the lazy one allowed ACTIVE→EXPIRED directly, the cron one insisted on a PAST_DUE stop first).
- **Gating a route on the subscription** — `SubscriptionService.requireActiveSubscription(tenantId)` replaces the old `requireActiveSubscription` Express middleware, and `assertQuota(tenantId, quotaField, count, label)` wraps it for "how many X may this tenant have" limits. PAST_DUE passes (that's what the grace period is for); EXPIRED/CANCELLED/no-subscription throw 403. `quotaField` is typed `QuotaField`, derived from the schema rather than hardcoded, so a new `quotaSnapshotMaxX` column is usable immediately. A limit is unlimited when it is `null` or **negative**; `0` is a real limit of zero (it used to be read as unlimited).
- Plan quotas are frozen onto the subscription at purchase time (`quotaSnapshot*`), never read live off the `Plan` — so a price-list change can't retroactively shrink an existing customer. All three write sites go through `quotaSnapshotOf(plan)` (exported from `subscriptions.service.ts`), so adding a quota means three edits: `Plan`, `Subscription.quotaSnapshot*` plus `quotaSnapshotOf`, and `prisma/seed.ts`.
- Day counts (`daysLeft`, `daysOverdue`) use `wholeDaysBetween`, which counts between midnights UTC. Dividing the raw millisecond gap — the previous approach — made the answer depend on the hour the endpoint happened to be called.

### Locations (branches & warehouses)

Branch and Warehouse are deliberately near-identical modules — a tenant runs several of each, and the frontend treats them as the same kind of thing.

**They now share one implementation.** `LocationService` (`src/modules/locations/location.service.ts`) holds list/detail/create/update/soft-delete and the manager appointment; `BranchService` and `WarehouseService` are ~45-line subclasses that pass a `LocationConfig` (Prisma delegate, quota field, the `User` column that posts someone there, and the Vietnamese wording) and wrap `appointManager` so the response keeps its old `branchId`/`warehouseId` key. `src/modules/locations/` is a plain shared folder, not a Nest module — there is no `/locations` route.

That exists because the pair had already fallen out of step once: iKiotMS-BE's `BranchService` refused to move a staff member out of the location they already worked at, and `WarehouseService` silently did it. Put new rules in `LocationService`; put something in a subclass only when it genuinely applies to one of the two. The delegate is typed structurally (`LocationDelegate`, `src/modules/locations/location.types.ts`) and `prisma.branch`/`prisma.warehouse` satisfy it as-is with no cast — which is why `include` is required on every read (omitting it changes what Prisma returns) and the methods are typed `Prisma.PrismaPromise` (so they can go into `$transaction`).

- **Delete is always soft** (`status = 'DELETED'`); `DELETE /branches/:id` and `/warehouses/:id` set it. Users, orders, inventory, stock movements and cash flows all hold a foreign key to these rows, so a hard delete would fail at the database anyway. Lists hide DELETED unless `?status=DELETED` is passed explicitly, and `status` is not accepted on create or update (`SETTABLE_LOCATION_STATUSES`) — that's what keeps the `delete` permission the only way to reach the state.
- Deleting refuses while any non-DELETED user is still posted there. Not in the old system; added because soft-deleting a location left its staff attached to something that appears in no list.
- **`PATCH /:id/manager` writes `managerId`, it does not change anyone's role.** iKiotMS-BE flipped `User.role` between `STAFF` and `BRANCH_MANAGER`/`WAREHOUSE_MANAGER`; those roles no longer exist (see Authorization), so the appointment is recorded on the location and what a manager may actually *do* is whatever custom `Role` the tenant gave them. The appointee must be active, in the tenant, and not already posted at a different location — appointing must never silently relocate someone.
- The geofence is stored flat (`attendance_latitude`, …) but the API keeps iKiotMS-BE's nested `attendanceTakingLocation` object; `src/common/dto/attendance-location.dto.ts` maps both ways (`toAttendanceColumns` / `withNestedAttendanceLocation`). Don't expose the flat columns.
- Creating either one consumes a plan quota (`maxBranches` / `maxWarehouses`) and requires a live subscription. `maxWarehouses` did not exist in iKiotMS-BE — it was added 2026-08-19 along with `warehouses.phone_number` / `warehouses.email`.
- `QueryBranchDto`/`QueryWarehouseDto` both extend `QueryLocationDto` (`src/modules/locations/dto/`), which carries the search-trim and the filterable-status rule. The create and assign-manager DTOs stay per-module: their validation messages name the thing being created.

### Staff accounts

iKiotMS-BE's `/staff` module lives at **`/users`**. CRUD was ported 2026-08-17; the
account-lifecycle and leave-balance half on 2026-08-25, keeping the old sub-paths:
`POST|PATCH /users/:id/leave-balance`, `POST /users/:id/account`,
`PATCH /users/:id/account/password`, `PATCH /users/:id/account/deactivate`.

- **`GET /users` is paginated and filtered** (`page`, `limit`, `search`, `status`,
  `roleId`, `branchId`, `warehouseId`) and returns the `{ data, pagination }` envelope.
  Two rules carried over from the old `getStaffFilter`: only STAFF accounts appear (the
  owner is never in their own staff list), and **the caller is excluded** — this screen is
  for managing other people. The old names `recordPerPage` and `keyword` become `limit`
  and `search`, matching every other ported list endpoint.
- **`PATCH /users/:id` covers the whole record** — email, role, posting, hire date, pay
  scheme, account note and the nested `profile` object. It refuses exactly what the old
  endpoint refused: `password`, `phoneNumber` and **`status`**. Status changes belong to
  the account-lifecycle routes, which run guards a plain field write would skip; accepting
  it here was a hole the first NestJS pass introduced, not something the old system allowed.
- **Naming one posting clears the other.** A staff member works at exactly one location, so
  sending `branchId` nulls `warehouseId` and vice versa (ported from
  `normalizeWorkplaceUpdateData`); sending both is a 400. Without it a partial update
  leaves a row claiming two workplaces, which the *next* edit then rejects — blaming
  whoever touched it last.
- **The phone number is validated as a real Vietnamese mobile line.**
  `validateVietnamPhoneNumber` (`src/modules/users/vietnam-phone.ts`, pure, unit-tested)
  checks the carrier prefix and rejects ranges that look like mobiles but cannot be one —
  VoIP 065, satellite 067, the 069 government block, 080, and the 111–115 emergency lines,
  each with its own message. It matters more than a length rule because the phone number
  **is the login handle** and the OTP destination: a number that can't receive an SMS is an
  account nobody can ever get into. `CreateUserDto` no longer carries a `@MinLength(8)`
  that would happily accept `"abcdefgh"`.
- **The citizen ID is validated against the record it lands on.**
  `validateVietnamIdentificationId` (`src/modules/users/vietnam-identification.ts`, pure,
  unit-tested) checks the 12 digits, the province prefix, and that the century/year and sex
  encoded in the number agree with `profile.dob` and `profile.gender`. Any of the three may
  be the field being edited, so the check runs against the merged result. Email and citizen
  ID must also be unique within the tenant — the old check left the citizen ID unscoped
  across every tenant, which let one shop discover another shop's staff.
- **Gated on `users:*`, not `staff:*`.** The catalog carries both resources; `users` is
  what this module has always checked, and two resources for one thing is how a permission
  ends up granted in one place and checked in the other. The `staff:*` pairs are legacy.
- **`GET /staff/roles` is not reproduced.** It returned the fixed role enum a requester
  could assign; roles are tenant-defined rows now, so `GET /roles` is the answer.
- **Most of the old service was role-hierarchy plumbing** — who may edit whom given
  BRANCH_MANAGER vs WAREHOUSE_MANAGER vs STAFF. None of it survives; "who may edit staff"
  is one permission.
- **Deleting is anonymising.** The row stays (orders, attendances, payslips and audit logs
  point at it) but the personal data does not, and `phoneNumber` becomes
  `deleted_<id>` — it is the login handle, so leaving it would block re-hiring the same
  person. Ported from `anonymizeDeletedStaff`, which the first NestJS pass had reduced to
  flipping a status.
- **Deactivating clears the password as well as the status**, so a token already in the
  wild is rejected on its next request (INACTIVE is in `INACTIVE_USER_STATUSES`).
- **Two guards on both deactivate and delete**: the account must not be the handover
  contact on a leave request still in force, and must not be the appointed manager of a
  branch or warehouse. The old code took a `replacementManagerId` and did the swap inline;
  appointment is `PATCH /branches/:id/manager` now, so this refuses and points there —
  one appointment rule, in one place.
- **Leave balance** answers `{ message, data, leaveBalance }`, the old shape.
  `remainingDays` is recomputed as `new allowance − days already used`,
  never overwritten, so raising a quota mid-year doesn't hand back spent leave. `POST`
  (opening balance) is valid only while nothing has been used. Both writes go through a
  conditional `updateMany` that fails if the numbers moved under them — the same
  optimistic-concurrency trick as `SupplierService.payDebt`.

### Products & inventory

A **Product** is the catalogue entry; a **ProductItem** is the sellable variant that carries
the price, the SKU and the stock. Almost everything interesting happens at the variant
level, which is why the routes are shaped the way they are.

- **`products`** — `POST/GET/PATCH/DELETE /products`, `GET /products/:id`, plus
  `GET /products/search` (the POS lookup) and `GET /products/items` (a flat variant list
  for pickers), and the variant routes `POST /products/:productId/items`,
  `PATCH|DELETE /products/items/:itemId`, `POST /products/items/:itemId/suppliers`.
- **`inventories`** — routed at `/inventory` (singular, as the old API and the catalog
  resource both spell it): `GET /inventory`, `PATCH /inventory/:id/min-stock`,
  `POST /inventory`, `DELETE /inventory/:id`.
- **The standalone `product-items` module was deleted.** It was generated CRUD at
  `/product-items` and would have been a way to create and delete variants without any of
  the rules below. Variants are reachable only through `/products/...`.

Route-order trap, same one the old Express module carried: `GET /products/items` and
`GET /products/search` must be declared **above** `GET /products/:id` or they are matched
as a product id. The three-segment variant routes can't collide with it and are declared
where they read best.

**Permissions — every product route is newly gated.** iKiotMS-BE registered all eleven on
bare `verifyJwt` with no `authorize()` call, so any logged-in account could rewrite the
whole catalogue; the `products` resource existed in `permissions.json` the whole time and
was simply never applied. On the inventory side, "add/remove a product at a location" used
to be gated on `role in (TENANT_OWNER, WAREHOUSE_MANAGER)` — neither that role nor
role-based gating exists any more, so those are `inventory:create` / `inventory:delete`.

**Deliberate deviations from the old API** (all of them fixes, not preferences):

- `DELETE /products/:id` and `DELETE /products/items/:itemId` **drop the old `/delete`
  path suffix**. Nothing else in either codebase used it. This one is visible to the
  frontend.
- **A live subscription is now required to create anything.** The old `createProduct`
  wrapped its entire body in `if (subscription)`, so a tenant without one got `undefined`
  back and an HTTP 200 — nothing created, nobody told. It goes through
  `assertQuota('quotaSnapshotMaxProducts')` now, counting non-DISCONTINUED products.
- **`categoryName` is derived, never accepted from the client.** It is a denormalized copy;
  taking it from the request let a product claim a category it wasn't in.
  `CategoryService.update` now refreshes it across the tenant's products on a rename —
  the debt this port was supposed to settle.
- **Deleting a variant checks every table that references it** (inventory, order items,
  stock-movement items, promotion items), not just inventory. In Mongo the leftovers were
  dangling refs; here they are foreign keys, so the old check would have surfaced as a
  constraint error with nothing useful to show.
- `VAT` is `vat` on the wire now, matching the column.

**Stock primitives live in `InventoryService`, not in the modules that move stock.**
`adjustStock` / `lowStockCrossing` / `notifyLowStock` are there for Order and
StockMovement to call once those are ported — "what happens to stock and when do we warn
about it" is one rule, and a copy each in sales and transfers is how the two end up
disagreeing. Two things about them:

- `adjustStock` and `initializeStock` take the **transactional client**, not
  `this.prisma`. A rolled-back sale that still moved stock is the failure mode.
- **Stock leaving for real goes through `deductStock`, not `adjustStock` with a negative
  delta.** It decrements with `stock: { gte: quantity }` in the `where`, so the check and
  the write are one statement: reading the level first and decrementing after leaves a
  window where two tills both see the last item and both sell it. iKiotMS-BE had exactly
  that shape and so did the first pass of this port. `adjustStock` stays for movements that
  *add* stock and for corrections already validated against a counted figure. Any
  `assertSourceStock`/`assertStockCovers` call left in the code is advisory — it tells the
  user early; it is not what enforces the rule.
- `adjustStock` is a single `upsert`, matching the old upserting `$inc`. A read-then-create
  leaves a window where two receipts into a location that doesn't stock the item yet both
  see nothing and both insert. Which of the two unique indexes it targets depends on which
  end is set — in Postgres a unique index containing a NULL constrains nothing, so
  `(tenant, branch, item)` only covers branch rows and `(tenant, warehouse, item)` only
  covers warehouse rows.
- `notifyLowStock` is called **after** the transaction commits, and never throws. The rule
  itself (`crossedLowStock` in `low-stock.ts`) is a pure function with its own unit test:
  it is **edge-triggered**, firing only on the step that crosses the threshold. Warning
  whenever `stock <= minStock` means every later sale of an already-short item fires
  again, and the manager mutes the channel on day one.

**The polymorphic location.** Inventory points at "a branch or a warehouse", which Mongo
stored as `locationId` + `locationType` and Postgres stores as a pair of nullable FKs.
`src/common/dto/location-ref.dto.ts` is the only place that maps between the two — the API
keeps the old pair, so the frontend is unaffected. Use `toLocationColumns` for writes,
`toLocationRef` for responses and `locationWhere` for filters; don't expose `branchId`/
`warehouseId` from a controller or rebuild the mapping at a call site. `LocationRefQueryDto`
carries the rule that naming a location requires naming its kind, and query DTOs compose it
with `IntersectionType` rather than restating it.

### Stock movements

`stock-movement-requests` is the module that actually moves stock, at `/stock-movements`.
Ten routes, same paths and same permissions as iKiotMS-BE: `POST`, `GET`, `GET /:id`, and
`PATCH /:id/{details,open,close,ship,receive,approve-adjust,cancel}`. There is no DELETE —
a movement is paperwork about goods that physically moved, so it is cancelled, never
removed. (The generated CRUD introduced `stock_movement:delete`; that catalog pair is now
unused.)

**Four movement types, two shapes of lifecycle** (`stock-movement.constants.ts`):

- `EXPORT` / `RETURN` — stock between two of our own locations:
  `DRAFT → OPENING → CLOSED → IN_TRANSIT → RECEIVED`.
- `IMPORT` (from a supplier) and `ADJUST` (a stocktake at one location) start at
  `PENDING` — there is nothing to pick and pack. `ADJUST` finishes at `COMPLETED`, since
  nothing arrived.

**Where stock actually changes**, and nowhere else: `ship` decrements the source (transfers
only), `receive` increments the destination by the **received** quantity, `approve-adjust`
applies `counted − recorded`, and `cancel` gives back what `ship` took if the transfer was
still IN_TRANSIT. Every one of those does the stock write and the status write **in one
transaction**, and sends its notifications **after the commit**.

**Supplier credit is enforced here** — the debt this port was meant to settle. Checked at
create and at update (would this order fit?), and again inside the receive transaction
after the debt is incremented (several imports can be open against one supplier at once, so
only the receipts that land count; exceeding it there throws and rolls the receipt back).
`creditLimit <= 0` means "no limit", matching the seed. The 75%-of-limit warning to the
owners uses `crossedCreditWarning` — a pure function with its own unit test, **edge
triggered** exactly like `crossedLowStock`: it fires on the receipt that crosses the line,
not on every receipt above it.

**Access control is a substitution, not a port.** The old service branched on
BRANCH_MANAGER / WAREHOUSE_MANAGER and on `managedScheduleAccess` (temporary rights from a
working schedule). Neither exists here — those roles are gone and WorkingSchedule is in the
deferred group — so: a TENANT_OWNER may act at any of the tenant's locations, and a STAFF
account may act at the one location they are posted to. **`canActAt()` is the only seam**;
when WorkingSchedule lands, widen that and nothing else. Two old rules were dropped rather
than translated: "branch managers cannot create IMPORT" (now simply who holds
`stock_movement:create`) and "branch managers cannot EXPORT to a warehouse", which survives
as a rule about the movement itself — branch → warehouse is a RETURN, whoever asks.

### Selling — orders, promotions, customers

Three modules that only make sense together: a cart is priced by `promotions`, rung up by
`orders`, and attached to a row in `customers`.

- **`orders`** — `POST /orders`, `GET /orders`, `GET /orders/:id`,
  `PATCH /orders/:id/status`, `POST /orders/:id/pay-offline`, plus the public
  `POST /webhook/sepay/order`. No DELETE: a sale that shouldn't have happened is
  CANCELLED or RETURNED, both of which leave a trail.
- **`promotions`** — CRUD plus `GET /promotions/:id/logs` and the three cart endpoints
  `POST /promotions/{candidates,calculate,apply}`. Only `/apply` writes.
- **`customers`** — CRUD plus a bulk `DELETE /customers`. Delete is soft (`isDeleted`);
  orders point at the row. `@@unique([tenantId, customerCode])` backs the code rule in the
  database — nullable, so any number of customers may carry no code, but never two the
  same. It is also what lets the walk-in customer (`KH_VANGLAI`) be resolved with an
  `upsert` **inside the order transaction**: find-then-create let two simultaneous
  anonymous sales create two walk-in rows, and creating it before the order was validated
  left one behind whenever the order failed.
- **The generated `promotion-logs` module was deleted**, for the same reason
  `product-items` was: it exposed `/promotion-logs` CRUD, which is a way to write usage
  rows without going through `/promotions/apply` and its caps. Logs are written there and
  read through `GET /promotions/:id/logs`.

**The order total is computed, never accepted.** iKiotMS-BE took `grandTotal` from the
request body, so a crafted call could ring up a full basket for zero — the gap CLAUDE.md
has flagged since the generated CRUD went in. `OrderService.grandTotalOf` derives it:
line totals minus per-line discounts, minus a manual `ORDER` discount. A `PROMOTION`
discount is **not** subtracted again — it is already spread across the lines and
`discountValue` is only a record of the total. `status`, `change` and `paymentReference`
are server-side for the same reason.

**And so is the discount** (2026-08-26). `OrderService.priceOrder` runs the promotions
the client named through `PromotionService.calculate` — the same engine `/promotions/calculate`
uses — and writes the result: each line's `discountAmount`, `discountType: 'PROMOTION'`,
`discountValue`, and the `promoName`/`discountAmount` on every `OrderAppliedPromotion` row.
The client sends `appliedPromotions: [{ promotionId }]` and nothing else.

- Before this, "the engine already spread it across the lines" was an *assumption about the
  client*: a till that sent `appliedPromotions` with a total but left `items[].discountAmount`
  alone got a full-price order and no error, so the customer paid the undiscounted amount
  while the screen showed the discount. Half-trusting the client is what made that possible —
  computing everything except the one number the client also computed.
- It also closes a second hole: the engine re-checks eligibility (dates, branch, minimum
  spend, usage caps, `status`), so an expired or out-of-branch promotion is a `400` instead
  of a discount. The old check only asked whether the id existed in the tenant, which is why
  a cross-tenant promotion id now answers `400` ("không còn tồn tại hoặc không áp dụng cho
  đơn này") rather than the `404` it used to.
- **`discountType: 'PROMOTION'` is no longer accepted from the client** — sending
  `appliedPromotions` is what makes a sale a promotion sale. `ORDER` (the manual whole-order
  discount) still is, and mixing the two is a `400`: there is one `discountType`/`discountValue`
  pair per order and no way to record a total that is part manual, part promotion.
- `items[].discountAmount` stays for a manual per-line discount on a sale with no promotions;
  it is overwritten by the engine's allocation when there are any.
- `grandTotalOf` rounds each line *before* subtracting, the way `pricing-engine.ts` rounds
  `lineTotal` — summing unrounded and rounding once at the end left a promotion sale a đồng
  or two from the total the preview quoted.
- The variants are looked up twice on a discounted sale (once by `priceLines`, once by the
  engine's cart builder). Deliberate: the engine owns its own view of the cart, and one extra
  indexed read per discounted sale is worth that.
- **Still a two-step for usage counting.** `usedCount` and `PromotionLog` only move when the
  client calls `POST /promotions/apply` with the `orderId` — same as iKiotMS-BE. Pricing an
  order does not commit a use, so a client that skips `/apply` gets the discount without
  burning a cap. Worth folding into the order transaction when someone owns that decision.

**`sepayTransactionId` is stored on both the order and its cash flow** (restored 2026-08-26;
migration `20260826102338_order_sepay_transaction_id`). It is SePay's own id for the transfer
and the only key linking either row to a line on the bank statement — the first port dropped
it and left nothing behind but a log line. `String?`, not the old model's `Number`: the
webhook payload is untyped JSON and an id is an identifier, not a quantity — the same call
`SubscriptionInvoice.transactionRef` already made. A malformed payload stores `null`, never
`''`, so "we have the id" and "we don't" stay distinguishable.

**`pricing-engine.ts` never touches the database.** Every rule about money lives there as
a pure function with a unit test, and the service hands it what it needs: the candidate
promotions, each cart line's category (a variant doesn't carry one — its product does), and
how many times this customer has already used each capped promotion. Two rules worth
knowing before changing anything:
- **Applying is always explicit.** The caller passes the exact ids the user picked; the
  engine never guesses a "best" combination, and a selected-but-ineligible promotion is a
  400 rather than a silent drop — quietly dropping one would charge more than the screen said.
- **At most two promotions, both stackable**, and each line's *accumulated* discount is
  clamped to its own total. Without the clamp, two promotions matching the same SKU
  discount it past its price and the order owes the customer money.

**Usage caps are re-checked inside the transaction** in `/apply`: the global one via a
conditional `updateMany` that only increments while there is room, the per-customer one by
re-counting logs, with `@@unique([orderId, promotionId])` as the backstop. The counts read
a moment earlier can be stale — two tills, or one customer with two tabs.

**Reads are branch-scoped.** A staff account sees the sales of the branch it is posted at;
`orders:view_all` widens that to the whole tenant (owners and admins always pass).
iKiotMS-BE didn't scope this at all — `orders:view_all` sat in the catalog unused, which
reads as the rule that was intended and never wired up. Same shape `stock-movements` uses.

**Cash flows.** A completed sale writes an INCOME row; a cash sale that gave change writes
an EXPENSE row too, because the drawer really did take the note and hand some back. **Only
the income row carries `orderId`** — `@@unique([orderId, flowType])` has to stay free for
the EXPENSE row a later RETURN writes. iKiotMS-BE left the change row unlinked as well;
it looks like an oversight and isn't.

**SePay, again but different.** `SepayOrderService` is the order half of the old
`sepayService.js` and is deliberately separate from `SepaySubscriptionService`: that one
pays iKiot's own account from env vars, this one pays **each tenant's** account from their
`banking.*` columns and identifies the tenant *by* the webhook key. Merging them would let
one integration's credentials settle the other's invoices. The webhook answers 200 for
every outcome so SePay stops retrying, and logs loudly when money arrives for an order that
was already settled another way — that needs a manual refund.

**Two substitutions, both from the RBAC redesign.** Promotion visibility used to branch on
BRANCH_MANAGER/STAFF; it is now "a TENANT_OWNER sees everything, a STAFF account sees
tenant-wide promotions plus their own branch's", and the old "a branch manager may only
create promotions for their own branch" rule goes with the role. And the paid-order
broadcast used to go to an `order:<id>` room clients joined themselves — that mechanism
was removed as a security fix (see "Realtime"), so it goes to `tenant:<id>` with the order
id in the payload.

**Customer routes are newly gated.** All six ran on bare `verifyJwt` in the old module, so
any logged-in account could read or delete the whole customer list; the `customers`
resource was added to the catalog during the RBAC redesign for exactly this.

### Cash drawer sessions

One branch's till for one trading day: opened with a counted float, passed from cashier to
cashier through shift logs, closed once with a counted total. Six routes at
`/cash-drawer-sessions`, same paths and permissions as iKiotMS-BE — `POST` (open),
`GET /current`, `GET`, `GET /:id`, `POST /:id/shift-logs`, `POST /:id/finalize`. No PATCH
or DELETE: a record of money changing hands is written, never edited.

**Two invariants, both in the database.** `@@unique([tenantId, branchId, businessDate])`
gives one session per branch per day; a **partial** unique index gives at most one OPEN
session per branch (see the Data-layer note above — it replaced a plain `@@unique` that
would have broken on day two). `open` catches P2002 and reports both as the same thing,
because at the till they are.

**The trading day is the shop's local day**, not UTC. `businessDate()`
(`business-date.ts`, pure, unit-tested) resolves it in `Asia/Ho_Chi_Minh` and returns
midnight UTC of that calendar day, which is what a Postgres `date` column wants. Doing it
in UTC would file every drawer opened before 07:00 local under the previous day's takings —
invisible until somebody reconciles a till and it is short by a shift.

**`updateMany` with an empty `data` does not touch `@updatedAt`.** Measured, not assumed —
so any optimistic guard of the form "update where updatedAt = what I read" has to write
something real, or it never advances and two identical requests both pass.
`submitShiftLog` writes `currentStaffId` unconditionally for exactly this reason (it is
unchanged unless the log is a handover). iKiotMS-BE got this for free: shift logs were an
embedded array, so `$push` always moved `updatedAt`. They are their own table here.

**The shift-log sequence is checked, not assumed.** A `START` is valid only as the first log
of the session or straight after an `END` that named this person; an `END` only from
whoever filed the matching `START`; and only the account currently holding the drawer may
write at all. An `END` with a `nextStaffId` is a handover — the drawer becomes theirs and
the session stays open. An `END` naming nobody is what makes the session finalizable, and
`finalize` refuses without it. Every write is guarded on the `updatedAt` we read, so a
concurrent log can't slip past the sequence check.

**Access is a substitution**, like everywhere else the old roles were involved.
`resolveBranch` is the single rule and every path goes through it — reads included:

- posted at a branch → that branch, and naming another is a 403, not a silent redirect;
- TENANT_OWNER / ADMIN, posted nowhere by design → whichever branch they name, or all of
  them where the caller doesn't need one;
- **anything else with no posting → 403.** A staff account granted `cash_drawers:read` but
  never assigned to a branch would otherwise fall through to "no branch filter" and see
  every till in the tenant. iKiotMS-BE threw here too.

It returns `null` for "every branch", never `''` — an empty string is still a `string` and
eventually reaches a `where` as though it were a real id.

`cash_drawers:read` vs `read_own` then decides whether they see the branch's sessions or
only the ones they worked. Both pairs had been in the catalog since the RBAC redesign with
nothing using them.

### Response envelope

**Every response is `{ success, message?, data }`**, iKiotMS-BE's shape, and no controller writes it by hand. `ResponseEnvelopeInterceptor` (`src/common/interceptors/response-envelope.interceptor.ts`, `APP_INTERCEPTOR`) wraps the success side; `AllExceptionsFilter` builds the failure side, since an exception never reaches an interceptor.

- **It merges rather than nests** when a handler already returns an object carrying `data` or `success`. That is what keeps `paginate()`'s `{ data, pagination }` arriving as `{ success: true, data, pagination }` — the old list shape exactly, so a client reading `body.data[0]`/`body.pagination.total` needs no change. It also covers the handlers that return `{ message, data, ... }` (subscriptions, leave-balance) and the bare `{ success: true }` ones (`DELETE /inventory/:id`, `DELETE /customers/:id`). Anything else — an entity, an array, a class instance — goes under `data`.
- **Return plain service results from controllers.** Don't add `success`/`data` by hand; two layers of envelope is the failure mode this replaced.
- **`@RawResponse()`** (`src/common/decorators/raw-response.decorator.ts`) opts a route out, for bodies whose shape belongs to somebody else: both SePay webhooks and the `GET /` healthcheck. Not for "this looks fine already" — the merge branch handles that.
- **Errors** leave as `{ success: false, statusCode, message, error?, errors? }`. A ValidationPipe failure keeps its per-field list under `errors` with a single-string `message` on top, matching what the old DTO validators sent; `statusCode`/`error` stay alongside so anything reading Nest's own three-key shape still works.
- **Registration order in `AppModule` is load-bearing**: Nest runs the response half of interceptors in reverse registration order, so the envelope is provided *before* `AuditInterceptor` and therefore wraps *after* it. Swapped, `AuditInterceptor` sees `{ success, data }` instead of the login body it reads the actor from, and every login writes a blank audit row.
- Wrap rules are unit-tested in `response-envelope.spec.ts`; the end-to-end shapes (list merge, error body, raw webhook) in `test/smoke.e2e-spec.ts`.

### Cash flows are written by events, never by a route

`/cash-flows` is **read-only**. iKiotMS-BE never exposed a route that wrote a `CashFlow`
row: the ledger is written by the things that actually moved money — a completed sale and
its change (`OrderService.writeSaleCashFlows`), a return, `SupplierService.payDebt`, a
payroll period marked paid — and read back through the stats endpoints. The generated CRUD
added `POST`/`PATCH`/`DELETE`, which is a way to book revenue that never happened and
delete revenue that did. Removed; `cash_flows:create/update/delete` are consequently unused
catalog pairs. A genuine "record cash nothing else explains" feature needs its own rules,
not a generic `POST` over the ledger.

### Uploads

`POST /uploads` → Cloudinary, folder `ikiot_uploads`, jpg/jpeg/png/webp/gif, 5MB, answers
`{ url }` — all ported from iKiotMS-BE's upload module. Authenticated but **not**
permission-gated, matching the old route: the URL is only useful once written onto a
product or a profile, and those writes are gated on their own resource.

The old module piped the file straight to Cloudinary with `multer-storage-cloudinary`;
here it arrives in memory (`FileInterceptor`) and goes up via `upload_stream`. One fewer
dependency, and validation happens somewhere it can answer a real 400 instead of a multer
error. The size limit is enforced twice on purpose — multer stops reading the socket, the
service re-checks for the message.

### Scheduling — shift templates & working schedules

`shift-templates` holds named patterns ("Ca hành chính 08:00–17:00"); `working-schedules`
cuts real shifts from them. Both ported whole from iKiotMS-BE's `schedule` module, at the
old paths.

- **Times went from strings to `@db.Time`.** `shift-time.ts` is the only place that maps
  between `"08:00"` and the column, and everything in it is **UTC on purpose**: Prisma
  hands a `time` back as a Date on 1970-01-01 in UTC, and reading it with `getHours()`
  would apply the server's zone and move every template by the offset.
- **A shift template may end before it starts** — 22:00–06:00 is a night shift. The old DTO
  had that check written and commented out (`IGNORE END TIME MUST BE AFTER START TIME`);
  `shiftInterval()` reads exactly that case to roll `endAt` onto the next day. The two are
  halves of one decision — changing either alone produces negative-length shifts.
- **`08:00` means 08:00 in Vietnam.** `schedule-time.ts` hardcodes +07:00 as the old
  `WorkingScheduleDateUtils` did. That is correct for Vietnam (no DST since 1975) and wrong
  in general; it stays because the alternative silently changes what every stored `startAt`
  means.
- **Bulk assignment merges by slot.** Rows naming the same template/day/type/times become
  one schedule with everyone on it — in memory first, then against whatever is already
  rostered. That is what makes "add Bình to Tuesday's morning shift" work.
- **`deduplicateWorkingSchedules` was not ported.** ~150 lines that merged duplicate
  schedule rows in the *response*, with a comment admitting it "doesn't fix the database".
  It existed because Mongo enforced no uniqueness. Migration
  `20260827030000_working_schedule_unique_slot` forbids the duplicates instead (partial —
  CANCELLED/DELETED rows must not block re-rostering the same slot), and the join table's
  `@@id([scheduleId, userId])` plus Attendance's `@@unique([userId, scheduleId])` close the
  rest. Dropping it also removed the reason the old list **paginated in memory**: it had to
  load every matching schedule before it could dedupe. Pagination is a `LIMIT` again.
- **`validateRoleHierarchy` is gone** with the roles it compared; rostering is
  `schedules:create`. What survives is "everyone rostered is an active STAFF in this
  tenant".
- Editing or deleting a shift is refused once anyone has clocked in against it — an
  attendance row's lateness was computed from that `startAt`.
- Removing the last person from a shift deletes the shift, as the old service did.

### Payroll

Four modules — `payroll-settings`, `paysheets`, `payroll-periods`, `payslips` — at the old
`/payroll/*` paths. Ported from `PayrollService` (1500 lines), `PayrollDayRateCalculator`,
`PaySheetService` and `PayrollSettingService`.

**Split three ways, and the split is the point.** `payroll-math.ts` holds every rule that
decides money as pure functions with no database access — 33 unit tests, same shape as
`pricing-engine.ts` and for the same reason. `PayslipBuilderService` loads the data and
applies them. `PayrollPeriodService` writes and moves a period through its lifecycle.

**Rules worth knowing before changing anything:**

- **A public holiday outranks a weekend** rather than stacking with it. Only
  `PUBLIC_HOLIDAY` carries a multiplier — a `COMPANY_HOLIDAY` is the shop's own closure and
  paying a statutory rate for one would invent money.
- **The restoration rules exist so nobody is punished twice.** When a late-penalty rule is
  configured, the *whole* shortfall from arriving late is added back to the payable minutes,
  because the money is taken by the penalty instead. With no such rule, only the grace comes
  back and the violation still costs time. Early leaving works the same way. This is why
  deductions have to be read *before* shifts are priced.
- **A `FIXED` employee's normal shifts produce zero-amount lines.** Their period salary is
  prorated across the whole period in `fixedWorkedPay`, capped at one day per date — doing
  it per shift makes that cap impossible when somebody works two shifts in a day. They can
  never earn more than `salaryPerPeriod`.
- **Turning up wins.** Worked a day you had also booked off? The hours are already paid;
  adding leave pay or deducting unpaid leave on top would count the day twice. The line is
  still written, with `ignoredBecauseAttended: true`.
- **Leave is allocated from the start of the request, not the start of the period**, and
  only onto days the employee was rostered. `PayslipBuilderService.gather` therefore loads
  schedules across the whole span of every leave request — otherwise a request straddling
  two periods would restart its allocation and pay the paid days twice.
- **`BY_BLOCK` rounds each violation up separately.** Two 16-minute violations against a
  15-minute block are 4 blocks, not 3; rounding the total would let repeated small
  violations escape. Unsupported rules (percentages, the old `BY_SALARY_COEFFICIENT`) are
  skipped and reported as `UNSUPPORTED_DEDUCTION_RULE` — a wrong deduction is money taken
  for a rule nobody wrote down.
- **Amounts are always recomputed server-side.** `POST /payroll/periods` re-runs the preview
  and stores *its* numbers, never the client's.
- **Generating refuses while anybody is unconfigured.** The preview lists who is missing a
  paysheet; saving a period that quietly excluded them would leave people unpaid with no
  flow to add them back.
- **`MARK_PAID` writes the `CashFlow` expense row and flips the status in one transaction**,
  so a period can never read as paid without the ledger entry proving it.
  `CashFlow.payrollPeriodId` is unique, so a replay writes no second row. The total is
  re-read *inside* that transaction — a figure from a list response is another request's
  answer and may be stale.
- **`paymentMethod` is server-owned and always `CASH`.** The old DTO accepted the field and
  rejected anything else; the reason is in `PayrollActionDto` — labelling a payout
  BANK_TRANSFER or SEPAY would mark money as having moved through an integration it never
  touched. The schema's other four values are unreachable.
- **Editing a draft payslip re-totals from the stored components**, never from the previous
  `netSalary`, so editing twice cannot compound. DRAFT only: once a period is in REVIEW an
  employee has been told to check their figures.
- **`SUBMIT` refuses when attendance changed under the draft.** There is no partial
  recalculation, so the honest answer is "cancel and regenerate" rather than submitting
  figures nobody can reproduce. `staleDraftPeriods` answers that for a whole page in **one
  query** — the old service ran one per period.
- **Employees see REVIEW, APPROVED and PAID payslips only.** DRAFT is the manager's working
  copy; REVIEW is visible on purpose, because that window exists for employees to object.
- `PayrollSetting.periodStartDay` exists and is **not honoured** — a period is always the
  calendar month. Not an oversight: iKiotMS-BE ignored it too and both its DTOs refused to
  let anyone set it. Only a stale comment claimed a 26th-to-25th period.
- `bonus` is always 0. The revenue tiers on a paysheet need per-employee revenue
  attribution that neither codebase computes; the configuration is stored, not priced.
- `@db.Date` on `periodStart`/`periodEnd` removed the old `buildPeriodDate` offset dance
  (Mongo had no date type, so periods were stored as Vietnam-midnight *instants*, with a
  warning never to `.toISOString().slice(0,10)` a stored value). Only
  `assertPeriodHasEnded` still needs the offset — "has the period ended" is a question about
  the shop's local date.

### Leave requests

Twelve routes at the old paths (`leave-requests`), ported from iKiotMS-BE's
`LeaveRequestService`. Two things make it more than CRUD, and both are about money and
cover:

1. **Approving spends the employee's annual allowance.** `paidLeaveDays` comes off
   `User.leaveBalanceRemainingDays` inside the approval transaction, through a conditional
   `updateMany` so two approvals can't overdraw it — matching nothing *is* the answer to
   "was there enough". Cancelling puts it back. The allowance defaults to 12 (the statutory
   minimum) and is filled in on first use, as the old service did in three places.
2. **A shift supervisor going on leave hands their shifts over.** Every `WorkingSchedule`
   they manage inside the window moves to `handoverToUserId` on approval.

- **"Manager" is a substitution, and a sharper one.** The old service asked
  `role in (BRANCH_MANAGER, WAREHOUSE_MANAGER)` in four places to decide whether handover
  applied. Those roles are gone, so the question becomes the one that was really being
  asked: *does this person manage any shifts in the window?* A branch manager with no
  shifts in the window never needed a handover either, so this is strictly more accurate.
- **Cancelling returns the shifts to the person who filed the leave** — restored during the
  port. iKiotMS-BE set `managedBy: null`, which is not the inverse of the approval: it left
  those shifts with no supervisor at all and, now that shift-supervisor rights exist,
  stripped the temporary permissions from both people.
- **Nobody reviews their own request**, whatever they hold — the point of an approval is
  that somebody else looked. A rejection must carry a `reviewNote`.
- **Cancelling is refused once the leave has started.** By then the roster was built around
  it and somebody has already covered the first day.
- `GET /leave-requests/me/per-day` expands each request to one row per calendar day, for a
  calendar view. `paidLeaveDays + unpaidLeaveDays` is checked against the *inclusive* day
  count — one day off is 1, not 0.
- `leave-date.ts` is deliberately separate from `working-schedules/schedule-time.ts`: that
  one converts *times* at Vietnam's offset because a shift starts at a wall-clock hour, and
  applying an offset to a leave day would shift the boundary and make a one-day leave span
  two dates.
- **`deleteLeaveRequest` is not ported.** It existed in the old service but no route reached
  it, and it neither restored the balance nor undid the handover.
- `LeaveRequestCronService` ports `leaveRequestJob.js`: 00:01 `Asia/Ho_Chi_Minh`, expiring
  PENDING requests whose start date has passed — the day happened with or without a
  decision, so the request stops blocking an overlapping one. Rows are loaded *before* the
  `updateMany`, since afterwards there is no way to tell which ones this run touched and
  each owner needs telling.

`NotificationService` is now fully ported: `approversOf()` reads the location's appointed
manager (falling back to the owners) and **always removes the requester**, so a manager
filing their own leave never becomes their own approver; `displayName()` supplies the name
in "X đã gửi đơn nghỉ phép" and never throws.

### Attendance

Clocking in and out (`attendances`), ported from `TakeAttendanceService` +
`ManageAttendanceService` — merged into one service since they share every rule. Seven
routes at the old paths.

**An attendance row is a payroll input**, and that shapes all of it: geofenced on the way
in, only writable against a shift the person is actually rostered on, every manual change
carrying a reason and the manager who made it, and frozen once the payroll period covering
it has been reviewed.

- **`workDate` is copied from the schedule, never derived from the check-in instant.** An
  early-morning or overnight shift would otherwise land on the wrong calendar day, and
  payroll groups by that date. The old service had the same comment on the same line.
- **The geofence has two distinct failures and they must not be collapsed** (`geo-fence.ts`,
  pure, unit-tested): `422 LOW_ACCURACY` for a GPS fix too vague to judge — the phone's
  fault, worth retrying — and `403 OUT_OF_RANGE` for a good fix that says the person is
  somewhere else. Accuracy is checked first for the same reason: a vague fix that happens to
  land far away is a bad fix, not a distant employee. Telling someone standing in the shop
  that they aren't allowed to be there is the failure this ordering prevents.
- **Check-in opens 30 minutes early and closes when the shift does.** Clocking in after the
  shift has ended isn't a late arrival — it needs a manager and a reason
  (`POST /attendances/manual`).
- **`lateMinutes` is now computed and stored at check-in.** iKiotMS-BE never wrote that
  column anywhere, which made `GET /attendances?lateOnly=true` a filter that could not
  match a single row. The rule is unchanged — `lateMinutesOf`, the same all-or-nothing
  grace the schedule view and payroll already use — so stored and derived values agree, and
  payroll's "prefer stored, else derive" fallback keeps historic rows working.
- **`overtimeOnly` was dropped rather than fixed.** It filtered on `Attendance.overtimeMinute`,
  which nothing wrote either — but unlike lateness, overtime has no definition anywhere in
  the old codebase to restore: extra hours are rostered as an OVERTIME *schedule*, not
  accumulated on an attendance row. Inventing a meaning for the column would be inventing a
  payroll rule.
- **A manager may never correct their own attendance**, whatever their permissions — the
  point of recording who made a manual edit is that it wasn't the person being paid for
  those hours.
- `assertPayrollPeriodOpen` ports `PayrollAttendancePolicy`: REVIEW and beyond freeze the
  inputs, DRAFT stays editable.
- Access substitution: your own always; `attendances:read` widens to your own location;
  writing somebody else's needs `attendances:update` plus the same location rule. That also
  fixes an old asymmetry — `assertCanManuallyCheckout` allowed TENANT_OWNER and
  BRANCH_MANAGER but *not* WAREHOUSE_MANAGER, so warehouse staff had nobody but the owner
  who could correct their attendance.

### Shift supervisor rights (`managedScheduleAccess`)

Whoever is `managedBy` on a **live** `WorkingSchedule` holds a fixed extra set of
permissions for the length of that shift — iKiotMS-BE's `managedScheduleAccess`, restored
now that scheduling is ported.

- `ShiftSupervisorService.resolve()` runs in `JwtStrategy` on every request, for the same
  reason the role's grants are re-read there: it has to reflect the clock on *this*
  request, and a shift that ended two minutes ago must grant nothing. One indexed query,
  and it short-circuits to `null` for anyone who isn't a STAFF account.
- **Three things keep it narrow, all ported.** Only `SCHEDULED` shifts whose window
  contains now (it expires by the clock — nothing to revoke); only the pairs in
  `TEMPORARY_PERMISSIONS`, a fixed code-owned set that can never grant more than a `Role`
  could; and only locations that are **both** on the shift and the supervisor's own
  posting. `suppliers` skips the location intersection because supplier records are
  tenant-wide — the old service made the same exception.
- Two halves, and both are required: `AuthUser.permissions` gains the keys (so
  `PermissionsGuard` passes), and `AuthUser.shiftSupervision` carries the locations.
  `supervisesLocation()` is the seam `StockMovementService.canActAt()` and
  `CashDrawerSessionService.resolveBranch()` widen through, exactly as CLAUDE.md promised
  they would.

### Holidays

The tenant's public-holiday calendar (`holidays` module), ported whole: six routes at the
old paths, plus `HolidaySyncService` (Google Calendar) and `HolidayCronService`.

- Every row is `type: PUBLIC_HOLIDAY` with `branchId: null` — the old service pinned both
  on every read and write. `COMPANY_HOLIDAY` is schema headroom nothing writes yet.
- **`isManuallyEdited` is the load-bearing field.** Anything a human creates, renames,
  moves or switches off is stamped with it, and the sync then leaves that row alone
  forever. A tenant that decides to trade through a national holiday must not have that
  undone by next month's refresh; `skippedManualCount` reports how many were left alone.
- **`isActive` is not settable through `PATCH /holidays/:id`** — `PATCH /:id/status` is its
  own route and the old DTO returned an explicit "dùng API /status" error rather than
  ignoring the field.
- Dates are `YYYY-MM-DD` → UTC midnight via `holidayDate()`; `2026-02-31` passes the regex
  and is rejected by `isRealCalendarDate`, as the old DTO did by round-tripping through
  `Date`.
- **The uniqueness rule needed a partial index.** `@@unique([tenantId, date, branchId, type])`
  reads like "one holiday per date" and in Mongo was, since a compound unique index there
  treats null as a value. Postgres doesn't — `branch_id` is NULL on every row this module
  writes, so the constraint was inert exactly where it was needed. Migration
  `20260827020000_holiday_unique_public_per_date` adds `WHERE branch_id IS NULL`; the plain
  `@@unique` stays for the branch-scoped rows. Same class as the cash-drawer partial index.
- `HolidayCronService` ports `holidaySyncJob.js`: 02:30 on the first of each month
  (`Asia/Ho_Chi_Minh`), current year **and** next — payroll and leave are planned across the
  year boundary, so December has to already know about January. Skipped without
  `GOOGLE_CALENDAR_API_KEY`, and one tenant's failure never stops the sweep.

### Support tickets

A two-sided thread between one shop and the platform operators (`tickets` module, eight
routes at the old paths — five under `/tickets`, three under `/admin/tickets`). Ported
whole from `src/modules/ticket`.

- **A ticket belongs to the shop, not to whoever filed it.** `GET /tickets/my` is named for
  the caller but filters on `tenantId`, so a colleague can read and answer the thread. That
  was the old behaviour and it is deliberate — a support conversation outlives the person
  who opened it.
- **`GET /tickets/:id` and `DELETE /tickets/:id` are shared by both consoles.** The old
  router had one handler each with the ownership test inside, not an `/admin` twin, so a
  link to a ticket resolves the same whoever opens it. `assertCanReach` is that test: an
  operator reaches every thread, anyone else only their own shop's.
- **`isDeletedByTenant` is the only delete.** Nothing is ever removed. The flag hides the
  thread from the shop while the admin list — deliberately unfiltered — keeps showing it
  with a "deleted" badge. The old handler set the flag *whoever* deleted, so an operator
  deleting a thread also hides it from the shop; kept as-is.
- **Status is a consequence of who spoke last**, never sent by the client: the shop's reply
  forces `OPEN` (needs an operator again), the operator's forces `IN_PROGRESS`, and
  `PATCH /admin/tickets/:id/close` is the only thing that writes `CLOSED`. Replying to a
  closed thread is a 400. `RESOLVED` exists in the enum and no route has ever written it.
- The status is written on every reply even when unchanged, so `@updatedAt` bumps and the
  thread rises to the top of both lists — Mongo's `ticket.save()` after pushing to the
  embedded `messages[]` array did that implicitly; with `messages` split into its own table
  a child insert alone would leave the parent untouched.
- The two sides notify asymmetrically on purpose. Opening a ticket writes a **system**
  notification (`tenantId`/`recipientId` both null) because operators live with the ticket
  list open; an operator's reply goes to the shop's owners' own inboxes, because they filed
  it and went back to work. Copy lives in `templates/ticket.templates.ts`.
- `ticketId` now comes from `generateReference(REFERENCE_PREFIX.TICKET)`. The old scheme was
  `TK-<last 6 digits of epoch ms><2 random digits>` against a unique column — the digits
  recycle every ~16.7 minutes over only 90 suffixes, so a collision was a raw P2002 → 500.
- **What changed:** every one of these routes ran on bare `verifyJwt` in the old system with
  no `authorize()` call at all, so any authenticated account could read or soft-delete any
  ticket it could name. They are gated on the `tickets` catalog resource here; the three
  admin routes replace the old inline `role === 'SUPER_ADMIN'` test with `AdminOnlyGuard`
  and carry no `@Permissions` (a platform admin has no tenant role to check).

### AI assistant (`ai-chat-histories`)

Five routes under `/ai`, ported from `src/modules/ai`. A shop owner asks a question in
Vietnamese; the assistant answers it out of the shop's own data using thirty read-only
tools, or out of Google Search, or out of nothing.

- **The tool permission table in `ai-tools.service.ts` is the security boundary of the whole
  feature.** The old implementation ran every tool as a hard-coded
  `{ tenantId, role: 'TENANT_OWNER' }` while the route was open to branch managers too, so
  asking the assistant for revenue returned the whole tenant's to someone `/stats/overview`
  would have narrowed to one branch — the assistant was a back door around every read rule
  in the system. The caller's real `AuthUser` is passed down now, and `run()` checks
  `can(user, resource, action)` before dispatching. `scripts/check-permissions.js` validates
  that table against the catalog, because a typo there fails *open*: `can()` is never
  consulted for a resource nobody holds, so the tool would simply run.
- **Tools delegate to the module that owns each question** (`StatsService` for revenue,
  `OrderService` for orders) rather than querying Prisma. A second copy of those rules here
  would drift and answer a shop owner with numbers that disagree with their own dashboard.
  This is why the module imports twenty others; nothing imports it back.
- **Model arguments go through the same DTO the REST endpoint validates.**
  `plainToInstance` supplies `page`/`limit` defaults, `validate` rejects invented values,
  and a rejection is handed to the model as a tool error it can read and retry.
- **The route decides which tools are armed, because Gemini will not combine custom
  functions with its own Search grounding.** That is the only reason `classify()` exists and
  costs an extra round-trip; a classification failure falls back to `GENERAL_LLM` and still
  answers.
- **The ReAct loop tracks "answered" separately from the step count.** The old loop ran
  `while (loopCount < maxLoops)` then threw on `loopCount >= maxLoops`, so an answer produced
  on the tenth and last allowed turn was discarded and the user was told the assistant was
  busy. `ai-agent.service.spec.ts` pins that case against a scripted client — `GeminiClient`
  is an abstract class bound in the module precisely so the loop is testable without a
  network or an API key.
- **Transcripts are `jsonb`, and only `{ role, parts: [{ text }] }` is persisted.** Tool
  calls and their results stay inside the request that made them, so a conversation never
  grows by a megabyte of report JSON. Reads degrade to an empty history rather than crashing
  if the column holds something unexpected.
- **A conversation belongs to one person, not the shop** — every query is scoped by
  `tenantId` *and* `userId`, so a colleague holding `ai_chat:read` still cannot read someone
  else's thread. Old behaviour, kept deliberately.
- An unset `GEMINI_API_KEY` is a 503, not the friendly in-chat fallback: it is an operator's
  problem to fix, and burying it in a chat bubble is how it stays unfixed for a week. Any
  *other* failure still saves the transcript with the fallback reply, so a question never
  sits with nothing beside it.
- Report tools default to **month-to-date**, not the stats module's rolling 30 days —
  "doanh thu tháng này" is the question people actually ask, and answering it with a rolling
  window would be wrong in a way nobody would notice.

### The operators' notification console (`/admin/notifications`, `/admin/system-notifications`)

Seven routes, ported from `src/modules/system-notification`, living in the `notifications`
module beside the shop-facing inbox because they read the same table.

- **`tenantId` and `recipientId` both null is what makes a row a system notification.**
  Every query in `AdminNotificationService` carries that pair (`systemFilter`), plus a
  whitelist of `SYSTEM_*` types as a second, narrower gate — so a new `notifySystem()` type
  never silently changes what an operator sees until it is listed on purpose.
- **`PATCH /admin/system-notifications/:id/read` had no filter at all** in the old
  controller — the one handler of five that forgot it. An operator could flip `isRead` on
  *any* notification by id, including one addressed to a single employee of one shop, and
  read its contents back from the response. It now uses the same filter as the delete
  routes and answers 404 otherwise; the e2e suite pins this.
- **An announcement is not a system event.** `POST /admin/notifications` is an operator
  *writing* to shop owners by email; it is stored in the same table with the same null pair
  but its own `ANNOUNCEMENT` type, and it never appears in the event feed. `targetTenants`
  is a join table (`NotificationTargetTenant`) and is written only for `SELECTION`.
- The email send is **fire-and-forget** and `EmailService.sendSystemNotificationEmail`
  swallows its own failures: one bad address must not fail the batch, and an operator
  writing to every shop in the country must not wait on hundreds of SMTP round-trips. The
  row is written first, so the record survives a delivery failure.
- The response counts **owners with an email on file**, not shops targeted — an owner who
  registered with only a phone number cannot be emailed, and the old code dropped them from
  the tally the same way.
- `category` stays free text (the value goes straight into the email subject line);
  `KNOWN_ANNOUNCEMENT_CATEGORIES` documents the four chips the console offers without
  closing the set.
- Both lists are paginated here where the old ones were a hard `limit(100)` and an
  unbounded `find()` respectively.

### Dashboards & reporting (`stats`)

Nine read-only endpoints at the old paths — eight under `/stats` for the shop, one
`/stats/admin/overview` for the platform operator. Ported from `src/modules/stats`.

- **Two dashboards, two ledgers, and confusing them would be a serious bug.** The shop's
  revenue is `Order`/`CashFlow` — money taken at the till. The operator's revenue is
  `SubscriptionInvoice` — what shops pay iKiot for their plans, against a different bank
  account entirely. Nothing crosses between them.
- **How much a caller sees is decided by their posting, not by `?branchId=`** (`stats-scope.ts`).
  The old service branched on `BRANCH_MANAGER`/`WAREHOUSE_MANAGER`, and everyone else
  holding `reports:read` — a cashier included — saw the whole tenant. Postings replaced
  those roles everywhere else in this codebase, and they do here too. Naming *another*
  location is a 403, where the old code silently ignored it and showed you your own numbers
  under someone else's heading. A warehouse posting has no sales to report, so the
  order-backed endpoints answer empty rather than falling back to the whole tenant.
- **`fromDate`/`toDate` accept a bare `YYYY-MM-DD` or a full ISO timestamp**, and a bare
  date means the whole *local* day — `toDate` becomes 23:59:59.999+07:00. Truncating it to
  midnight would silently drop the named day's sales.
- **`previousPeriod` is what every `changePct` compares against**: the equal-length window
  ending 1 ms before the range starts. `changePct` answers `null`, never `0`, when the
  previous period was zero — there is no honest percentage for "from nothing to something",
  and `0` reads on a dashboard as "flat".
- **`stats-math.ts` holds all of it as pure functions** with unit tests, same shape as
  `pricing-engine.ts` and `payroll-math.ts`.
- **Four answers are hand-written `$queryRaw`** because Prisma cannot express them: local-day
  bucketing (`to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', …)`), line revenue
  (`SUM(unit_price * quantity - discount_amount)`), and stock valuation
  (`SUM(stock * cost_price)` across a join). Computing them in JS would mean loading every
  order line of the period into memory. Everything `groupBy`/`aggregate` can do uses Prisma.
  All interpolation goes through tagged-template bind parameters; the single exception is
  `getTopProducts`' `ORDER BY` column, which Postgres will not accept as a parameter and is
  therefore chosen from a two-value whitelist, never from the query string.
- **The local timezone in bucketing is load-bearing.** A sale rung up at 23:30 belongs to
  that day's takings; grouping on the raw UTC timestamp files it under tomorrow for every
  shop in Vietnam.
- `customerCount` counts distinct `customerId`, and all walk-in sales share the tenant's one
  `KH_VANGLAI` row, so they total as a single "customer". The old aggregation `$addToSet`-ed
  a null id and landed on exactly the same number — the port does not change the figure.
- `/stats/inventory`'s `lowStockThreshold` is a flat query parameter, deliberately **not**
  the per-row `Inventory.minStock` the alerting engine uses: `minStock` means "this needs
  reordering", the threshold here is a "show me everything under N" slider.
- `flow=ORD|SUP|PAYR` picks a money-flow by reference prefix. Note `ORD` is not a synonym for
  income — a refunded order writes an ORD-prefixed EXPENSE.

### Shared list conventions

Ported list endpoints take `PaginationQueryDto` (`src/common/dto/pagination-query.dto.ts` — `page`, `limit`, max 100) and return `paginate(...)` from `src/common/utils/pagination.ts`: `{ data, pagination: { total, page, limit, totalPages } }`, the shape iKiotMS-BE's controllers spread into their responses. Use these rather than hand-rolling `skip`/`take` per module. The response envelope merges this rather than nesting it — see above.

### Cross-cutting services ported so far

- **`NotificationService`** (`src/modules/notifications/notifications.service.ts`) — the fan-out side (`notify()`, `tenantOwners()`) ports iKiotMS-BE's `notificationService.js`; `notify()` never throws, same invariant as before, and now both writes the `Notification` row and emits over the recipient's `user:<id>` Socket.IO room (still no FCM push — see "Not yet wired up"). `managersOfLocation()` is ported too (used by the low-stock warning) — it reads `Branch.managerId`/`Warehouse.managerId` rather than the old BRANCH_MANAGER/WAREHOUSE_MANAGER roles, and falls back to the tenant's owners when a location has no manager, where the old version silently notified nobody. `approversOf`/`displayName` are ported too, alongside the modules that needed them (leave requests, payroll). Put every module's notification copy in its own `templates/*.templates.ts` file, never inline (see "Notification & audit templates" above). The inbox side (`listInbox`, `unreadCount`, `markAllRead`, `markRead`, `deleteAll`, `deleteOne`, `registerDeviceToken`, `removeDeviceToken`) is also a real port now — `notifications` module, own-inbox-only (scoped to `{tenantId, recipientId: user OR null}`), no cross-user listing. The platform operators' side lives beside it in `AdminNotificationService` — see "The operators' notification console" above.
- **`EmailService`** (`src/common/email/`) — ported whole from `emailService.js` (nodemailer, same HTML templates): `sendSubscriptionReminder()` for the billing cron. `sendSystemNotificationEmail()` is ported too, for operator announcements.
