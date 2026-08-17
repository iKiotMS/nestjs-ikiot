# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

iKiot-BE — a NestJS/TypeScript backend for iKiotMS, a multi-tenant retail/inventory management system (products, orders, inventory, staff, payroll, subscriptions/billing). This is the PostgreSQL/Prisma rewrite target of the mature Node/Express + MongoDB backend at `../iKiotMS-BE` — see that project's `CLAUDE.md`/`AGENTS.md` for the business logic and conventions this is migrating *from*. Package manager is pnpm (`pnpm-lock.yaml`).

Data layer and module scaffolding for all 33 top-level entities are in place (see Architecture below). **Real business logic has been ported for**: auth (`auth`), staff/role management (`users`, `roles`), audit logging (`audit-logs`, now tenant *and* platform scoped), notifications (`notifications`, inbox + fan-out, realtime over Socket.IO), and billing (`plans`, `subscriptions`, `subscription-invoices`). Everything else (payroll calculators, promotion pricing engine, product/inventory rules, etc.) is still plain generated CRUD over Prisma — treat those modules as infrastructure, not feature-complete, until their own real port lands.

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

**`test:e2e` boots the real `AppModule`, so it needs a reachable `DATABASE_URL`** (`docker compose up -d`). Three pieces of its jest config exist only to get that far under jest — don't remove them without re-running the suite:
- `node --experimental-vm-modules` in the script — Prisma 7's generated client `import()`s its WASM query compiler dynamically, which plain CJS jest can't do.
- `moduleNameMapper: {"^(\\.{1,2}/.*)\\.js$": "$1"}` — the generated Prisma client uses ESM-style `./foo.js` specifiers from `.ts` files.
- `moduleNameMapper: {"^jose$": "<rootDir>/jose.stub.js"}` — `jose` is ESM-only and pulled in by `firebase-admin` → `jwks-rsa`; nothing in the tests exercises it. See the comment in `test/jose.stub.js`.

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

These were generated by `scripts/generate-modules.js`, which parses `prisma/schema.prisma` directly (not hand-written per module) — see that script if the schema changes enough to warrant regenerating. It's a maintained tool but not part of the build: **re-running it overwrites every file it generates**, so fold changes into its templates rather than hand-editing a still-generated module. Models already ported by hand are listed in `PORTED_MODELS` and skipped; add a model there the moment its module stops being generated code, or the next run will destroy the real implementation.

**Not yet wired up, in rough priority order for porting business logic from iKiotMS-BE** (per the "Thứ tự build đề xuất" in the Feature Ledger artifact — remaining groups: org/reference data (Branch/Warehouse/Brand/Category/Supplier), HR config (PayrollSetting/Paysheet/ShiftTemplate/Holiday), Staff, Schedule/Attendance/LeaveRequest, Payroll, Product/Inventory/StockMovement, Order/Promotion/CashDrawer, Ticket/Stats/AI):
- The still-generated CRUD controllers are fully gated now (auth + tenant scope + `@Permissions()`); what they still lack is the **real business logic** — the services under them are one Prisma call per method, so payroll totals, promotion pricing, inventory quotas and the like don't exist yet. The route surface is also plain CRUD, not the old system's richer endpoints (`/orders/:id/pay-offline`, `/leave-requests/:id/approve`, ...), which is why so many catalog actions are still unused (run `node scripts/check-permissions.js` to list them).
- The response envelope (`{ success, message?, data? }`) and matching global exception filter used throughout iKiotMS-BE — controllers currently return raw Nest/Prisma results (including the ported ones — `auth`/`roles`/`users`/`audit-logs`/`plans`/`subscriptions`/`subscription-invoices` don't wrap responses either, for consistency until this is decided app-wide).
- Real business logic for every module past the ones listed above (payroll calculation, promotion pricing engine, attendance/schedule rules, product/inventory quota checks, etc.) — the generated services are intentionally thin CRUD, not ports of the original logic.
- Refresh tokens — still deferred (see Authorization below); there is no `/auth/refresh` or `/auth/logout` yet. OTP registration and Firebase login **are** ported (`/auth/send-otp`, `/auth/register` requires `otpCode`, `/auth/firebase-login`) — see Authorization.
- OTP codes are stored **in-memory** (`OtpService`), same caveat as refresh tokens: won't survive a restart or work across multiple instances, revisit once Redis is wired.
- Push (FCM) notification delivery — `NotificationService.notify()` writes the row and emits over Socket.IO now (see "Realtime" below) but still has no push leg; `UserFcmToken` rows are collected (`POST /notifications/device-token`) but nothing sends to them yet.

ESLint (`eslint.config.mjs`) uses `typescript-eslint`'s `recommendedTypeChecked` + `eslint-plugin-prettier`; notably `no-explicit-any` is turned off and `no-floating-promises`/`no-unsafe-argument` are warnings, not errors.

### Swagger (API docs)

Served at `/docs` once the server is running (`main.ts`). Uses the `@nestjs/swagger` CLI plugin (`nest-cli.json` → `compilerOptions.plugins`), which auto-infers `@ApiProperty()` on every DTO from its existing `class-validator` decorators and TS types — **this only runs through `nest build`/`nest start`, not plain `tsc`**, so verify docs by running the dev server and checking `/docs`, not just a type-check. Every controller has `@ApiTags('<route>')`; the hand-built modules (`auth`/`roles`/`users`) additionally use `@ApiBearerAuth('bearer')` (the bearer scheme is registered under the name `'bearer'` in `main.ts`'s `DocumentBuilder` — reuse that exact name, don't invent a new one per module).

**Rule — keep Swagger in lockstep with the real API, in the same change, every time:**
- New controller → add `@ApiTags('<route>')` on the class immediately; add `@ApiBearerAuth('bearer')` (class- or method-level) the moment the route stops being `@Public()`.
- New/changed DTO field → the CLI plugin infers it from `class-validator` decorators automatically in most cases; only hand-add `@ApiProperty()` when the plugin can't express what's needed (an `example`, a `description`, an enum of literal values, etc.) — don't add it redundantly when the plugin already covers it.
- Changed route, removed field, or changed auth/permission requirement → re-check `/docs` after the change. The plugin regenerates docs from source every build, so it won't show *stale* info, but a guard/permission change (e.g. adding `@Permissions()`) has no visible effect in Swagger UI unless paired with the matching `@Api*Auth()` decorator — those two are declared independently and will not silently stay in sync with each other.
- Never leave a controller newly ported from iKiotMS-BE without `@ApiTags()` — every module in "Not yet wired up" above still needs this the moment its real port begins, not deferred to a cleanup pass.

### Authorization (RBAC redesign, 2026-08-14)

Deliberately **not** a port of iKiotMS-BE's fixed 6-role enum + static `permissions.json`. `User.systemRole` is a coarse account kind — `ADMIN | TENANT_OWNER | CUSTOMER | STAFF`:

- **`ADMIN`** (platform) and **`TENANT_OWNER`** are fixed and always full-access. Neither is ever a row in the `Role` table — `PermissionsGuard` short-circuits both before checking anything. `User.tenantId` is nullable specifically so `ADMIN` accounts can exist outside any tenant.
- **`CUSTOMER`** is a separate, minimal, fixed-permission account kind (`CUSTOMER_PERMISSIONS` in `src/common/constants/system-role.ts`) — intentionally outside the tenant role-management system.
- **`STAFF`** accounts hold a tenant-owned, tenant-editable `Role` (`User.roleId`), each with a set of `RolePermission` rows (`resource`, `action`). A `TENANT_OWNER` creates roles and toggles permissions per role via the `roles` module (`POST/PATCH/DELETE /roles`, owner/admin-only via `OwnerOrAdminGuard` — deliberately *not* routed through the permission catalog itself, so no custom role, however permissive, can ever grant itself role-management access).
- `RolePermission.(resource, action)` is constrained by a real FK into `PermissionCatalog` — a fixed, code-owned taxonomy (`prisma/seed.ts`, run via `npx prisma db seed`; 150 pairs across 30 resources). Tenants pick from this catalog; they cannot invent new resource/action pairs, since every `@Permissions(resource, action)` guard in code is written against a specific pair. Add new pairs to `prisma/seed.ts` (and re-seed) whenever a newly-ported module needs one that doesn't exist yet. It started as iKiotMS-BE's `permissions.json` but is no longer a straight copy: four resources (`customers`, `tickets`, `cash_flows`, `ai_chat`) and a scattering of actions were added because **the old system declared those permissions but never enforced them on the routes** — `/customers`, `/tickets` and `/products` all ran on bare `verifyJwt` with no `authorize()` call, so any logged-in user could reach them. Each addition is commented where it sits in `CATALOG`.
- Branch/warehouse scope (`User.branchId`/`warehouseId`) stays independent of role — a role decides *what* a STAFF account can do, not *where*.
- **Permissions are re-checked fresh on every request**, not cached in the JWT: `JwtStrategy.validate()` (`src/modules/auth/strategies/jwt.strategy.ts`) re-fetches the user + their role's current permissions from Postgres on each call. This is a deliberate departure from iKiotMS-BE (which trusted role claims baked into the JWT payload) — the entire point of tenant-editable roles is that revoking a permission must take effect immediately, not after the access token expires.
- Route-level usage: `@Permissions('products', 'create')` on a handler; `PermissionsGuard` (registered globally via `APP_GUARD` in `AppModule`, after `JwtAuthGuard`) reads it via `Reflector` and checks `req.user.permissions` (a precomputed `Set<"resource:action">`). No decorator on a route means "any authenticated user" (JwtAuthGuard alone gates it) — `@Public()` opts a route out of auth entirely (used by `/auth/login`, `/auth/register`, `/auth/send-otp`, `/auth/firebase-login`, and `GET /`, the healthcheck in `app.controller.ts`).
- **Every `@Permissions(resource, action)` pair must exist in the catalog** — `RolePermission` has a real FK into `PermissionCatalog`, so a pair with no catalog row can never be granted to any role, silently turning that route into ADMIN/TENANT_OWNER-only. Nothing in the type system catches this, so `node scripts/check-permissions.js` cross-checks the two; run it after touching either a controller's decorators or the seed's `CATALOG`. It also prints catalog pairs no route uses yet, which is expected while modules are unported.
- Which resource each generated module maps to lives in `RESOURCE` in `scripts/generate-modules.js` (the generator refuses to run for a model missing an entry). Some modules deliberately share a resource — product variants under `products`, shift templates under `schedules`, promotion logs under `promotions` — rather than each getting its own.
- **`@Permissions()` is no protection from a TENANT_OWNER**, who short-circuits the guard entirely. That matters for platform-level resources like the generated `tenants` module: gate those with `AdminOnlyGuard` instead, the way `/admin/plans` and `/admin/audit-logs` do.

**Seed data** (`prisma/seed.ts`, run via `npx prisma db seed`): besides the `PermissionCatalog`, also seeds one dev `ADMIN` account — phone `0000000000`, password `password123`, `tenantId: null`. Idempotent (find-then-create, re-running the seed won't duplicate it or touch an existing one) — **change this password before any non-local deployment**, it's a fixed, publicly-known dev credential.

**OTP + Firebase login** (`src/modules/auth/{otp,esms,firebase}.service.ts`) — ported from iKiotMS-BE's `src/services/{otpService,esmsService}.js` and `src/config/firebase.js`, same behavior:
- `OtpService` generates a 6-digit code, stores it **in-memory only** (`Map`, 5 min TTL) — no Redis yet, same caveat as refresh tokens (won't survive a restart, won't work across multiple instances; revisit together). `NODE_ENV !== 'production'` allows a dev bypass via `DEV_OTP_BYPASS_TOKEN` (defaults to the literal `DEV_BYPASS`), or an empty code.
- `EsmsService` sends via the real eSMS API only when `ESMS_API_KEY`/`ESMS_SECRET_KEY` are set; otherwise (any non-production env) `OtpService` logs the code to the server console instead — same graceful-degrade as the old system, don't require ESMS to be configured for local dev to work.
- `FirebaseService` lazy-initializes `firebase-admin` from `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`; `/auth/firebase-login` throws a clean 401 ("chưa được cấu hình") rather than crashing when those are unset. Matches by email only — **no auto-provisioning**, the `User.email` must already exist. `platform: 'mobile'` gates to `systemRole === STAFF`; anything else (default `'web'`) allows every account kind except `CUSTOMER` — the direct equivalent of iKiotMS-BE's `STAFF_ROLES` gate now that `BRANCH_MANAGER`/`WAREHOUSE_MANAGER`/`STAFF` have collapsed into one `STAFF` systemRole with a custom `Role`.

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
- **Route-specific description logic no longer lives in the interceptor.** `AuditInterceptor` only holds the generic mechanism (actor resolution, IP capture, generic `Tạo mới/Cập nhật/Xóa <Resource>` fallback) plus an injected `AuditDescriptor[]` (`src/common/audit/audit-descriptor.ts`) it checks first. Each domain module that needs a friendlier description implements its own `*.audit-template.ts` (e.g. `src/modules/subscriptions/subscription.audit-template.ts` for `/subscription/upgrade/:tenantId`) and is wired into the list via `AppModule`'s `APP_INTERCEPTOR` factory (`useFactory`, `inject: [...]`) — see the rule below and the comment at that factory for how to add the next one.

It also infers "did the request succeed" from whether the handler's observable emitted a value, not a real HTTP status code (exact, since every failure path here throws an `HttpException`, which makes the observable error instead of emit). There is still no create/update/delete for `AuditLog` — rows are only ever written by the interceptor.

### Notification & audit templates — no god services

**Rule: `NotificationService` and `AuditInterceptor` must never contain another module's business text or route-specific logic.** Both are delivery/recording *mechanisms* — what a notification says, and how a specific route's audit entry reads, belongs to the domain module that owns that event, in a dedicated file:
- Notification copy → `src/modules/notifications/templates/<domain>.templates.ts`, exporting typed functions returning `NotificationContent` (`{ type, title, description, link? }`). See `subscription.templates.ts` for the shape. The calling service spreads the template into `notify()`: `this.notifications.notify({ tenantId, recipientIds, referenceId, ...SomeTemplates.someEvent(args) })` — never writes `title`/`description` inline.
- Audit descriptions → `src/modules/<domain>/<domain>.audit-template.ts`, a class implementing `AuditDescriptor` (`matches(path)` + `describe(ctx)`), registered into `AuditInterceptor` via the `APP_INTERCEPTOR` factory in `AppModule`. See `subscription.audit-template.ts`.

Why this matters: both `NotificationService.notify()` and `AuditInterceptor.describe()` are called from every domain in the app. The moment one of them accumulates a growing `if (path.includes('/some-new-route'))` chain or a wall of hardcoded Vietnamese strings for every event type, it becomes a god object that every unrelated PR has to touch and understand. Keep them thin dispatchers; put growth in the domain's own template file instead.

### Subscription & billing

Real port of iKiotMS-BE's `SubscriptionService`/`SubscriptionController`, split across three Nest modules that share one Prisma-backed data layer (`plans`, `subscriptions`, `subscription-invoices`) — same as the old system covered `Plan`/`Subscription`/`SubscriptionInvoice` from one service, since `activateAfterPayment` writes to two of the three tables in one transaction.

- **`plans`**: `GET /plans` (public, active only) and `GET/PUT/PATCH /admin/plans...` (`AdminOnlyGuard`). No create/delete endpoint — matches the old system exactly, plans are seeded/managed directly against the database (`prisma/seed.ts`).
- **`subscriptions`**: `/subscription/free-trial`, `/subscription/status` (lazy TRIAL→EXPIRED / ACTIVE→PAST_DUE→EXPIRED transitions, same `GRACE_PERIOD_DAYS=3`), `/subscription/upgrade/initiate`, `/subscription/renew/initiate`, `/subscription/upgrade/:tenantId` (admin-only, no payment), and `POST /webhook/sepay` — all ported field-for-field from the old `SubscriptionService`/`_createPlanInvoice`/`activateAfterPayment`. The webhook always resolves HTTP 200 except a bad API key, same as before, so SePay never retries into our bugs.
- **`SepaySubscriptionService`** (`src/modules/subscriptions/sepay-subscription.service.ts`) is the **subscription-only** half of iKiotMS-BE's `sepayService.js` (`IKMS` prefix, iKiot's own company bank account via `SEPAY_ACCOUNT_*` env vars). It is deliberately a separate service from order payments (`ORD` prefix, each tenant's own `banking.*` fields) — don't merge them when orders get ported, they're structurally different integrations that happen to share a webhook-signature pattern.
- **`SubscriptionCronService`** (`@nestjs/schedule`, `EVERY_DAY_AT_2AM`, skipped when `NODE_ENV=test`) ports `src/jobs/subscriptionJob.js` 1:1 — batch status-transition sweep, then expiry-reminder notifications+emails at `REMINDER_DAYS=[7,3,1]` days out. `ScheduleModule.forRoot()` is registered once in `AppModule`.
- One intentional behavior fix vs. the old code: `activateAfterPayment`'s webhook-triggered history-log entry now sets `changedById: null` instead of iKiotMS-BE's `changedById: <tenantId>` (a tenant ID in a "changed by user" field read as a bug, not a feature — there's no acting user for an automated payment event).
- `src/common/utils/reference-generator.ts` (`generateReference`, `REFERENCE_PREFIX`) is shared, reusable infrastructure ported from `referenceGenerator.js`/`referencePrefix.js` — reuse it (don't reinvent) when Order/Supplier/Payroll reference codes get ported.

### Cross-cutting services ported so far

- **`NotificationService`** (`src/modules/notifications/notifications.service.ts`) — the fan-out side (`notify()`, `tenantOwners()`) ports iKiotMS-BE's `notificationService.js`; `notify()` never throws, same invariant as before, and now both writes the `Notification` row and emits over the recipient's `user:<id>` Socket.IO room (still no FCM push — see "Not yet wired up"). Port `managersOfLocation`/`approversOf`/`displayName` when the modules that need them (leave requests, stock movement, tickets, ...) get their real business logic — and put their notification copy in a new `templates/*.templates.ts` file, not inline (see "Notification & audit templates" above). The inbox side (`listInbox`, `unreadCount`, `markAllRead`, `markRead`, `deleteAll`, `deleteOne`, `registerDeviceToken`, `removeDeviceToken`) is also a real port now — `notifications` module, own-inbox-only (scoped to `{tenantId, recipientId: user OR null}`), no cross-user/admin listing.
- **`EmailService`** (`src/common/email/`) — only `sendSubscriptionReminder()` is ported from `emailService.js` (nodemailer, same HTML template). `sendSystemNotificationEmail()` is deferred until the system-notification/announcement module is ported.
