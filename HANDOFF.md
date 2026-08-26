# Session Handoff

Đọc file này trước khi làm tiếp — dành cho một phiên Claude Code mới (hoặc bạn) tiếp tục công việc migrate `iKiotMS-BE` (Node/Express/Mongoose) sang `iKiot-BE` (NestJS/Prisma/PostgreSQL) từ một máy khác. File này là **nhật ký theo ngày** (mục mới thêm ở cuối, không sửa lại mục cũ trừ khi nó sai) — còn `CLAUDE.md` mới là tài liệu kiến trúc "hiện trạng đúng nhất", luôn cập nhật theo mọi quyết định ở đây. Đọc `iKiot-BE/CLAUDE.md` và `iKiotMS-BE/CLAUDE.md` trước.

## Bối cảnh

`Code-trom/` là workspace chứa 2 project độc lập:
- **`iKiotMS-BE/`** — backend cũ (Express + MongoDB), nguồn sự thật cho toàn bộ business logic. Không sửa gì ở đây trừ `CLAUDE.md`.
- **`iKiot-BE/`** — backend mới (NestJS + Prisma + PostgreSQL), đang được build dần từ đây.

## 2 tài liệu tham chiếu đã xuất bản (Claude Artifacts)

Nếu đăng nhập cùng tài khoản Claude trên máy khác, 2 link này vẫn xem được (browse thêm tại claude.ai/code/artifacts nếu link đổi):

- **iKiotMS Postgres Migration** — https://claude.ai/code/artifact/bc9977f1-823d-41c3-a713-4ded56332db3 — bản đồ chuyển đổi từng field của 34 model Mongoose sang bảng Postgres/Prisma.
- **iKiotMS Feature Ledger** — https://claude.ai/code/artifact/53e9a4c4-4409-487a-9fe6-b3f5901d9114 — kiểm kê đầy đủ ~150 endpoint + business rule của 28 module trong `iKiotMS-BE`, cộng **56 vấn đề/bug/điểm mơ hồ** cần chốt trước khi port từng module. **Đọc mục "Vấn đề cần chốt" trong đó trước khi port bất kỳ module nghiệp vụ nào** — đặc biệt payroll (#27: bonus engine chưa từng chạy, phải xây mới) và leave-request (#25: mâu thuẫn quyền warehouse manager).

## Nhật ký theo ngày

### 2026-08-14 — RBAC + Auth nền tảng

1. **`prisma/schema.prisma`** — schema Postgres đầy đủ cho 33 entity + child/join table, convert từ Mongoose (xem comment đầu file schema).
2. **RBAC tuỳ biến theo tenant** — thay hệ 6-role cố định cũ bằng `User.systemRole` (`ADMIN | TENANT_OWNER | CUSTOMER | STAFF`) + `Role`/`RolePermission`/`PermissionCatalog`. Chi tiết đầy đủ: mục **"Authorization"** trong `iKiot-BE/CLAUDE.md`.
3. **3 module đầu tiên có guard thật**: `auth`, `roles`, `users`.
4. **Guard toàn cục**: `JwtAuthGuard` + `PermissionsGuard` gắn qua `APP_GUARD`.
5. Bắt và sửa 1 lỗ hổng có sẵn từ trước: `main.ts` chưa từng bật `ValidationPipe` toàn cục — đã bật.

Lúc này: chưa có Postgres thật để test, chỉ `pnpm run build`/`tsc --noEmit` pass. Git: 1 commit gốc, mọi việc trong session đang staged chưa commit.

### 2026-08-17 — Swagger, OTP/Firebase thật, seed admin, Audit, Subscription & Billing

1. **Swagger** — `@nestjs/swagger` + CLI plugin (tự sinh metadata từ `class-validator`, xem `nest-cli.json`), `/docs`, `@ApiTags` trên cả 35 controller lúc đó. Rule bắt buộc cập nhật Swagger cùng lúc sửa API đã thêm vào `CLAUDE.md`.
2. **OTP đăng ký thật** — `OtpService`/`EsmsService` port từ `otpService.js`/`esmsService.js`. Chưa có `ESMS_API_KEY` trong `.env` → code OTP log ra console server (đúng hành vi cũ). Lưu OTP **in-memory** (chưa Redis).
3. **Firebase login thật** — `FirebaseService` port từ `config/firebase.js`. `.env` thiếu `FIREBASE_PRIVATE_KEY` → endpoint trả 401 "chưa cấu hình" cho tới khi bạn thêm key đó.
4. **Seed tài khoản ADMIN**: SĐT `0000000000` / mật khẩu `password123`, `systemRole: ADMIN`, không thuộc tenant nào. **Đổi mật khẩu này trước khi deploy thật** — đây là credential cố định, ai đọc code cũng biết.
5. **Audit logging thật** — `AuditInterceptor` (global, port từ `auditMiddleware.js`) + `GET /admin/audit-logs`.
6. **Subscription & Billing thật** — port đầy đủ từ `SubscriptionService`/`SubscriptionController` cũ: `plans` (public + admin CRUD), `subscriptions` (free-trial/status/upgrade/renew/webhook SePay), `subscription-invoices`. Kèm theo vì Subscription phụ thuộc: `NotificationService.notify()`/`tenantOwners()` (ghi DB thật, **chưa có Socket.IO/push** — chỉ mới viết `Notification` row), `EmailService` (nodemailer thật), `SepaySubscriptionService` (tách riêng SePay cho subscription khỏi SePay cho order — đừng gộp 2 cái khi port order), cron job nhắc hết hạn hàng ngày (`@nestjs/schedule`), seed 5 gói TRIAL/PLUS/PLUS_YEARLY/PRO/PRO_YEARLY.
7. **Đã chạy migrate + seed + test thật trên Postgres local** (`docker-compose.yml` bạn tự thêm, `postgres:17` tại `localhost:5432`) — không chỉ compile suông: đăng nhập admin, xem audit log, đăng ký tenant mới bằng OTP dev-bypass, gán free-trial, nâng cấp gói (sinh QR SePay thật), giả lập webhook thanh toán → subscription chuyển `ACTIVE` đúng, admin bật/tắt gói, xác nhận non-admin bị 403. Tất cả pass.
8. Chi tiết kỹ thuật đầy đủ của tất cả mục trên: 2 mục mới trong `CLAUDE.md` — **"Audit logging"** và **"Subscription & billing"**, cộng mục **"Cross-cutting services ported so far"**.

Lúc này: `.env` đã có `DATABASE_URL` thật (Postgres local qua Docker) + hầu hết secret thật khác (SEPAY_*, MAIL_*, CLOUDINARY_*, GOOGLE_*, REDIS_URL, GEMINI_API_KEY) — chỉ thiếu `FIREBASE_PRIVATE_KEY`, `ESMS_API_KEY`/`ESMS_SECRET_KEY`.

**Cùng ngày, phần 2 — Socket.IO + Notification/Audit thật cho tenant + kiến trúc chống god-service:**

9. **`RealtimeGateway`** (`src/common/realtime/`, global) — Socket.IO thật, port từ `socketService.js` nhưng sửa 1 lỗ hổng bảo mật: bản cũ cho client tự `emit('join', room)` bất kỳ room nào kể cả `admin`; bản mới server tự join room (`user:<id>`, `tenant:<id>`, `admin`) dựa trên JWT lúc connect, client không tự chọn room được.
10. **`NotificationService.notify()`** giờ emit socket thật (trước đó chỉ ghi DB). Inbox tenant port đầy đủ: `GET /notifications`, `/unread-count`, `PATCH /read-all`, `PATCH /:id/read`, `DELETE /`, `DELETE /:id`, `POST`/`DELETE /device-token`.
11. **Audit mở rộng cho tenant** — trước chỉ log `ADMIN`, giờ log mọi actor trừ `CUSTOMER`. Thêm `GET /audit-logs` (owner-only, scope theo tenant) song song `GET /admin/audit-logs` (platform, không đổi).
12. **Kiến trúc chống god-service (yêu cầu rõ của bạn)** — tách nội dung notification + logic mô tả audit ra khỏi service dùng chung:
    - Notification: `src/modules/notifications/templates/*.templates.ts` (vd `subscription.templates.ts`) — service module khác gọi template, không hardcode title/description.
    - Audit: `src/common/audit/audit-descriptor.ts` (interface) + `src/modules/<domain>/<domain>.audit-template.ts` (vd `subscription.audit-template.ts`) — `AuditInterceptor` chỉ còn cơ chế chung + fallback, không còn if/else riêng theo route. Đăng ký descriptor mới qua factory `APP_INTERCEPTOR` trong `app.module.ts` (1 dòng `inject` mỗi module).
    - Rule đầy đủ đã ghi vào `CLAUDE.md` mục **"Notification & audit templates — no god services"**.
13. **2 bug thật bắt được lúc test (không phải suy đoán)**:
    - `AuditInterceptor` fallback tên actor hardcode literal `"ADMIN"` — sai với mọi role khác không có tên/email. Sửa: fallback về `phoneNumber` (đã thêm field này vào `AuthUser`).
    - `SubscriptionAuditTemplate.matches()` dùng `path.includes('/subscription/upgrade/')` — vô tình khớp luôn `/subscription/upgrade/initiate` (route hoàn toàn khác, của tenant tự nâng cấp) chứ không chỉ `/subscription/upgrade/:tenantId` (route admin). Sửa: thêm `&& !path.endsWith('/initiate')`.
14. **Test thật end-to-end** (không chỉ build): đăng nhập, connect Socket.IO thật bằng JWT (dùng `socket.io-client` cài tạm rồi gỡ), trigger nâng cấp gói + giả lập webhook trong lúc socket đang lắng nghe → nhận đúng event `notification` qua socket. Audit tenant/admin đều đúng actor + resource sau khi sửa 2 bug trên.

Lúc này: build/lint/typecheck sạch, đã test thật qua Postgres + Socket.IO local, đã dọn hết dependency/file tạm dùng để test.

### 2026-08-17, phần 3 — dọn dẹp (code review toàn repo)

Không thêm tính năng, chỉ dọn những thứ review phát hiện:

15. **Xoá `src/user/`** — 4 file **rỗng 0 byte** (`user.module.ts`, `user.controller.ts`, `user.service.ts`, `schemas/user.schema.ts`) sót lại từ scaffold Mongoose ngày 12/8, đã được commit vào git, không import ở đâu. Module user thật là `src/modules/users/`.
16. **`pnpm run lint` từ trước đến giờ vẫn FAIL — giờ mới sạch.** 55 lỗi: 54 lỗi `no-unsafe-assignment` do generator sinh `data: data as any` trong 27 service CRUD, + 1 import `Query` thừa. Hoá ra cast đó **hoàn toàn không cần** (chính `eslint --fix` tự gỡ và `tsc` vẫn pass) → bỏ hẳn `as any`, không thay bằng type khác. Đã sửa cả `scripts/generate-modules.js` để chạy lại generator không tái tạo lỗi, đồng thời cho nó emit sẵn `@ApiTags` và chỉ import `Query` khi model có `tenantId`.
17. **Comment TODO sai sự thật ở 27 controller** (`// TODO: apply JwtAuthGuard ... once auth/tenant are ported`) — auth đã port xong từ ngày 14/8 và `JwtAuthGuard` là global guard nên các route này **đã** được bảo vệ. Thay bằng comment đúng: đã có JWT guard, còn thiếu `@Permissions()` + tenant-scoping.
18. **`test:e2e` từ trước tới giờ chạy là vỡ** (chưa ai chạy). 3 nguyên nhân xếp chồng, đã fix hết trong `test/jest-e2e.json` + script: Prisma 7 `import()` WASM query compiler → cần `node --experimental-vm-modules`; client Prisma sinh ra dùng specifier kiểu ESM `./x.js` → cần `moduleNameMapper` bỏ đuôi `.js`; `firebase-admin` → `jwks-rsa` → `jose` (ESM-only) → stub bằng `test/jose.stub.js`. Giờ e2e boot nguyên `AppModule` thật với Postgres thật và **pass**.
19. **`GET /` "Hello World!"** của scaffold → đổi thành healthcheck `@Public()` trả `{status, uptime}` (global `JwtAuthGuard` sẽ 401 endpoint này nếu không đánh dấu `@Public`, mà healthcheck của load balancer thì không có token). Cập nhật luôn cả unit test và e2e test tương ứng.
20. **`void bootstrap()`** trong `main.ts` — dọn nốt warning `no-floating-promises` duy nhất còn lại.

Đã verify lại sau khi dọn: `tsc` sạch, `lint` sạch (lần đầu tiên), `build` OK, unit test pass, e2e pass (2/2), và smoke test thật trên server dev: healthcheck 200, `/notifications` không token → 401, login admin OK, và CRUD đầy đủ (create/update/delete) trên `brands` — một trong 27 service vừa bị sửa — đều đúng.

### 2026-08-17, phần 4 — tenant/actor lấy từ token, không nhận từ client

21. **`src/common/utils/tenant-scope.ts`** — 2 hàm quyết định tenant của mọi request: `resolveTenantScope(user, requested?)` cho **đọc** (ADMIN không nêu tenant → `undefined` = mọi tenant; người khác luôn là tenant của chính mình, gửi tenant khác → 403) và `requireTenantId(user, requested?)` cho **ghi** (ADMIN buộc phải nêu tenant, nếu không → 400).
22. **26 module CRUD sinh tự động**: `tenantId` không còn nằm trong query/body nữa mà lấy từ token. `?tenantId=` chỉ còn là **override riêng cho ADMIN**. Đây vừa là dọn API vừa là vá lỗ hổng thật: trước đó bất kỳ user đã đăng nhập nào cũng đọc/ghi được dữ liệu của tenant khác chỉ bằng cách đổi query string.
23. **Trường "ai làm" cũng tự điền từ token**: `createdById` (CashFlow, Paysheet, PromotionLog, StockMovementRequest, WorkingSchedule) và `userId` ở những model mà nó thật sự nghĩa là người thao tác (Order, Ticket, LeaveRequest, AIChatHistory) — đã đối chiếu với controller cũ bên `iKiotMS-BE` để xác nhận. **Cố ý KHÔNG đụng** `Attendance.userId` và `Payslip.userId`: ở 2 model này `userId` là *nhân viên được chấm công / được tính lương*, quản lý nhập hộ người khác (xem `CreateManualAttendanceDTO.js` bên code cũ) — tự điền vào là sai nghiệp vụ.
24. **`findOne`/`update`/`remove` giờ mới thật sự scope theo tenant.** Trước đây chỉ `findAll` lọc, còn 3 cái kia tìm theo `id` không → đọc/sửa/xoá xuyên tenant được. Truy cập nhầm tenant trả **404 chứ không phải 403** (không để lộ việc bản ghi có tồn tại hay không). Dùng `findFirst` + `NotFoundException` tự ném, vì lỗi `findFirstOrThrow` của Prisma không phải `HttpException` nên Nest trả 500 — cái này phát hiện lúc test thật, không phải khi đọc code.
25. **Các module đã port thật** (`users`, `roles`, `audit-logs`, `subscriptions`, `subscription-invoices`): thay `user.tenantId!` bằng `requireTenantId(user)`. Non-null assertion đang che một bug thật — ADMIN có `tenantId = null` nên `GET /users` bằng token ADMIN trước đây trả `[]` im lặng, giờ báo 400 rõ ràng.
26. **`scripts/generate-modules.js`** thêm `PORTED_MODELS` — chạy lại generator trước đây sẽ **ghi đè và phá sạch** 9 module đã port bằng tay (User/Role/Plan/Subscription/AuditLog/Notification...). Giờ nó bỏ qua các model đó.

Test thật (tạo tenant B + owner B tạm rồi xoá): tạo brand không truyền tenantId → đúng tenant từng owner; A không thấy dữ liệu B; A đọc/sửa/xoá bản ghi của B → 404; A truyền `?tenantId=` của B → 403; ADMIN list → thấy cả 2 tenant, `?tenantId=` → lọc đúng; ADMIN tạo không nêu tenant → 400, có nêu → 201; Ticket/CashFlow tự điền đúng `userId`/`createdById`; nhét `tenantId` của B vào body → vẫn lưu vào tenant của A. Đã xoá sạch fixture và dữ liệu test sau khi chạy.

### 2026-08-17, phần 5 — `@Permissions()` cho toàn bộ 27 module CRUD

27. **Gắn `@Permissions()` cho cả 27 module** (5 route mỗi module = 100 cặp resource:action đang dùng). Map module → resource nằm ở `RESOURCE` trong `scripts/generate-modules.js`; generator **dừng hẳn** nếu có model chưa khai báo resource. Một số module cố ý **dùng chung** resource thay vì tự đẻ ra cái mới: `ProductItem` → `products` (biến thể sản phẩm), `ShiftTemplate` → `schedules`, `PromotionLog` → `promotions`.
28. **Phát hiện quan trọng khi đối chiếu code cũ**: `permissions.json` cũ có khai báo quyền, nhưng **route thật thì không gọi `authorize()`** — `/customers`, `/tickets`, `/products` chỉ có `verifyJwt`, ai đăng nhập cũng vào được. Vì vậy catalog gốc thiếu hẳn resource cho 4 module. Đã thêm mới: `customers`, `tickets`, `cash_flows`, `ai_chat`; và bổ sung action còn thiếu vào 7 resource sẵn có (`orders:delete`, `inventory:create/delete`, `attendances:delete`, `payrollSettings:delete`, `stock_movement:delete`, `cash_drawers:create/update/delete`, `payslips:create/read/update/delete`). Catalog: **121 → 150 cặp / 26 → 30 resource**. Mỗi chỗ thêm đều có comment giải thích ngay tại `CATALOG`.
29. **`scripts/check-permissions.js`** — script mới, đối chiếu mọi `@Permissions()` trong source với `CATALOG` trong seed. Cần thiết vì TypeScript không bắt được lỗi này: một cặp không có trong catalog thì **không role nào cấp được**, route âm thầm biến thành chỉ ADMIN/TENANT_OWNER vào được — kiểu bug rất lâu sau mới lộ. Chạy sau mỗi lần sửa decorator hoặc sửa seed. Nó cũng liệt kê các cặp có trong catalog mà chưa route nào dùng (hiện 50 — bình thường, vì các endpoint giàu hơn như `/orders/:id/pay-offline`, `/leave-requests/:id/approve` chưa port).
30. **Lưu ý đã ghi vào code + CLAUDE.md**: `@Permissions()` **không chặn được TENANT_OWNER** (họ short-circuit guard). Module `tenants` sinh tự động là resource cấp platform nên thật ra phải dùng `AdminOnlyGuard` như `/admin/plans`, chưa làm.

Test thật: tạo role "Thu ngan test" chỉ có `brands:read` + `orders:create`, gán cho 1 STAFF mới → `GET /brands` 200; POST/PATCH/DELETE `/brands` và toàn bộ `/payslips` `/products` `/customers` `/cash-flows` `/tickets` `/ai-chat-histories` `/inventories` `/orders` đều 403 kèm message rõ (`Missing permission payslips:read`). TENANT_OWNER và ADMIN vẫn vào hết. **Quan trọng nhất**: owner thêm `payslips:read` vào role → STAFF dùng **token cũ** gọi lại ngay được 200; thu hồi → 403 lại ngay. Đúng như thiết kế fetch quyền từ DB mỗi request (không cache trong JWT). Đã xoá sạch role/user test sau khi chạy.

### 2026-08-19 — port thật 5 module org/reference data (branches, warehouses, suppliers, brands, categories)

31. **Đổi schema + migration viết tay** `20260819043000_warehouse_contact_and_plan_max_warehouses`. `prisma migrate dev` **từ chối tự sinh** vì `plans.max_warehouses` là cột NOT NULL mà bảng đã có 5 dòng — nên migration này viết tay: thêm cột với `DEFAULT -1` rồi `DROP DEFAULT` ngay sau đó (gói mới bắt buộc phải khai hạn mức, giống `max_branches`). Ba thay đổi: `warehouses.phone_number`/`email` (kho giờ có thông tin liên hệ y như chi nhánh), `plans.max_warehouses`, `subscriptions.quota_snapshot_max_warehouses`. Seed 5 gói: Trial 1 kho / Plus 2 / Pro không giới hạn. **Lưu ý**: thêm một quota mới luôn là 4 chỗ sửa — `Plan`, `Subscription.quotaSnapshot*`, cả 3 chỗ ghi snapshot trong `subscriptions.service.ts`, và `prisma/seed.ts`.
32. **`SubscriptionService.requireActiveSubscription()` + `assertQuota()`** — thay cho middleware `requireActiveSubscription` của bản cũ. Luật hết hạn lazy (TRIAL/ACTIVE/PAST_DUE→EXPIRED) được gom vào một private `settleSubscription()` dùng chung với `checkTrialStatus()`, thay vì bản cũ chép luật ở 2 nơi. PAST_DUE vẫn cho qua (đúng ý nghĩa grace period).
33. **3 lỗi thật trong code sinh tự động của 5 module này** (không phải thiếu tính năng — là bug):
    - `remove()` là `prisma.delete()` **xoá cứng**. Bản cũ soft-delete branch/warehouse; xoá cứng một branch có users/orders/inventory/cash_flows trỏ vào sẽ nổ FK → 500.
    - `Supplier.outstandingDebt` **nằm trong Create/Update DTO**, client PATCH là sửa được công nợ. Bản cũ chặn phòng thủ trong service (`delete updateData.outstandingDebt`); giờ bỏ hẳn khỏi DTO.
    - `status` là field **bắt buộc** trong `CreateBranchDto`/`CreateWarehouseDto` → tạo được chi nhánh `status: "DELETED"` ngay từ đầu.
34. **`PATCH /:id/manager` đổi ngữ nghĩa** — bản cũ lật `User.role` giữa `STAFF` ↔ `BRANCH_MANAGER`/`WAREHOUSE_MANAGER`; hai role đó **không còn tồn tại** sau RBAC redesign. Giờ chỉ ghi `Branch.managerId`/`Warehouse.managerId`, **không đụng `roleId`** của nhân viên — quản lý được làm gì là do tenant tự gán Role. Ràng buộc: nhân viên phải ACTIVE, cùng tenant, và **chưa trực thuộc nơi làm việc khác** (bổ nhiệm không được âm thầm điều chuyển người).
35. **Kho giờ được đối xử y như chi nhánh** (theo yêu cầu "có nhiều warehouse"): phân trang/tìm kiếm/soft delete/quota gói/quy tắc bổ nhiệm chặt như branch. Bản cũ cho phép lấy **bất kỳ** nhân viên nào trong tenant làm quản lý kho — chỉ an toàn khi mỗi tenant có đúng 1 kho.
36. **Supplier giữ nguyên tính năng**: `POST /suppliers/:id/payments` (`suppliers:pay_debt`) trừ công nợ + ghi `CashFlow` EXPENSE + thông báo cho chủ cửa hàng, trong 1 transaction. Dùng `updateMany` có điều kiện `outstandingDebt >= amount` thay vì đọc-kiểm-ghi, để 2 lần thanh toán đồng thời không cùng lọt qua và ghi âm công nợ. Trả **200** (không phải 201 mặc định của Nest POST) cho khớp API cũ.
37. **Categories** giữ đủ: `GET /categories/tree` (phải khai **trước** `@Get(':id')`), breadcrumbs trong detail, chống vòng lặp `parentId` (tự làm cha / lấy hậu duệ làm cha), chặn xoá khi còn con hoặc còn sản phẩm. **Brands/categories giờ scope theo tenant** — bản cũ để global và **không có `authorize()` nào**, ai đăng nhập cũng sửa/xoá được thương hiệu của cả hệ thống.
38. **Dùng chung mới**: `common/dto/pagination-query.dto.ts` + `common/utils/pagination.ts` (`{data, pagination}` — đúng shape bản cũ), `common/dto/attendance-location.dto.ts` (map giữa 4 cột phẳng và object `attendanceTakingLocation` lồng của API cũ), `common/constants/location-status.ts`, `common/constants/payment-method.ts`.
39. Đã thêm `Branch`/`Warehouse`/`Supplier`/`Brand`/`Category` vào **`PORTED_MODELS`** — không thêm là lần chạy generator kế tiếp xoá sạch.

Test thật (2 tenant, 96 assertion, pass hết — script ở scratchpad, không commit): quota gói chặn đúng (Trial 2 chi nhánh / 1 kho, message rõ ràng); soft delete giữ nguyên dòng trong DB và biến mất khỏi list nhưng vẫn xem được bằng `?status=DELETED`; xoá chi nhánh/kho còn nhân viên → 400; cross-tenant đọc/sửa/xoá đều **404** (không phải 403); STAFF chỉ có `branches:read` → list 200, tạo/bổ nhiệm/xem supplier đều 403; bổ nhiệm quản lý không đổi `systemRole` lẫn `roleId`; nhân viên đang thuộc chi nhánh không bị kéo sang kho; trả nợ NCC 400k/1tr → còn 600k + đúng 1 `CashFlow` `SUP...` với `created_by` lấy từ token, trả vượt → 400 và **rollback sạch** (công nợ không đổi, không sinh cash flow); trial hết hạn → `settleSubscription` tự chuyển EXPIRED, `POST /branches` 403 nhưng `GET /branches` vẫn 200 (đúng bản cũ: chỉ route tạo mới bị chặn). Đã xoá sạch 2 tenant test khỏi DB sau khi chạy.

`tsc` · `pnpm run lint` · `node scripts/check-permissions.js` (không phải sửa seed — catalog đã đủ) · `pnpm run build` · unit 1/1 · e2e 2/2 đều sạch.

### 2026-08-20 — review toàn bộ code đã port rồi sửa hết những gì review chỉ ra

Không thêm module mới. Đây là đợt dọn: 5 lỗ hổng/thiếu sót thật, 3 nhóm trùng lặp, 8 chỗ khó đọc.

**A. Lỗ hổng & thiếu sót thật**

40. **4 route subscription của tenant trước đây không kiểm quyền gì cả** — `/subscription/free-trial`, `/subscription/status`, `/subscription/upgrade/initiate`, `/subscription/renew/initiate` chỉ có `JwtAuthGuard` toàn cục, không có `@Permissions()`. Nghĩa là **bất kỳ STAFF nào** cũng tự kích hoạt trial hoặc mở hoá đơn nâng cấp được. Giờ: `subscriptions:manage` cho 3 route ghi, `subscriptions:read` cho route status (TENANT_OWNER vẫn qua tự động vì short-circuit guard). Catalog đã có sẵn 3 action này, không phải sửa seed. Route `/subscription/upgrade/:tenantId` vẫn `AdminOnlyGuard` như cũ.
41. **Bật CORS + helmet trong `main.ts`** — cả hai đều chưa có, trong khi bản cũ `iKiotMS-BE` có đủ; frontend khác origin sẽ bị chặn ngay. CSP của helmet dùng bộ directive Nest khuyến nghị cho Swagger, vì CSP mặc định chặn luôn `/docs`. Origin đọc từ `CORS_ORIGIN` (danh sách ngăn bởi dấu phẩy; bỏ trống = cho mọi origin — **chỉ dùng khi dev**).
42. **`AllExceptionsFilter`** (`src/common/filters/`, đăng ký cả `APP_FILTER` lẫn `useGlobalFilters`) — trước đây mọi lỗi Prisma đều rơi ra **500 trống**. Giờ P2002→409, P2003/P2000/P2011/P2014→400, P2025→404, còn lại log stack rồi trả 500 chung chung (không rò message nội bộ). **`HttpException` được cho đi thẳng, không đụng vào** — body `{statusCode, message: string[], error}` của ValidationPipe là thứ frontend đang parse. *Đây là một nửa của mục "response envelope" trong danh sách còn nợ; nửa còn lại (interceptor bọc response) vẫn chưa làm.*
43. **28 file `update-*.dto.ts` import `PartialType` sai chỗ** — từ `@nestjs/mapped-types` thay vì `@nestjs/swagger`. Validation vẫn đúng, nhưng plugin Swagger không thấy field kế thừa: `PATCH /branches/:id` trên `/docs` chỉ hiện mỗi `status`. Đã đổi hết + sửa **template trong `scripts/generate-modules.js`** (không sửa template thì lần chạy generator sau tái tạo lại lỗi). Gỡ luôn `@nestjs/mapped-types` khỏi dependencies.
44. **IP trong audit log trước đây client tự đặt được** — `AuditInterceptor` đọc thẳng header `x-forwarded-for` mà app chưa hề bật `trust proxy`. Giờ đọc `request.ip` (Express tự suy ra, và chỉ tin header khi `trust proxy` được cấu hình), `main.ts` set `trust proxy` từ `TRUST_PROXY` (số hop; bỏ trống = không có proxy). Hai biến mới `CORS_ORIGIN`/`TRUST_PROXY` đã ghi chú trong `.env`.

**B. Trùng lặp đã gom**

45. **`branches.service.ts` và `warehouses.service.ts` giống nhau ~90%** (223 và 211 dòng) → `LocationService` (`src/modules/locations/location.service.ts`) giữ toàn bộ logic, hai service còn **~45 dòng** mỗi cái: một `LocationConfig` (delegate Prisma, quota, cột `User` ghi nơi làm việc, và toàn bộ chuỗi tiếng Việt) + một wrapper `assignManager` để giữ nguyên key `branchId`/`warehouseId` trong response. `src/modules/locations/` **không phải Nest module**, không có route `/locations`. Delegate được khai kiểu structural (`LocationDelegate`) — `prisma.branch` và `prisma.warehouse` **thoả mãn nó nguyên trạng, không cast**; đổi lại `include` bắt buộc ở mọi lệnh đọc và các method trả `Prisma.PrismaPromise` để dùng được trong `$transaction`. `QueryBranchDto`/`QueryWarehouseDto` giờ extend `QueryLocationDto`. Lý do làm việc này: cặp này **đã lệch nhau một lần rồi** ở bản cũ (branch chặn điều chuyển nhân viên, warehouse thì không).
46. **Luật chuyển trạng thái subscription tồn tại 2 bản** — `settleSubscription()` (lazy) và `runSubscriptionStatusCheck()` (cron) mỗi bên tự viết lại, và **đã lệch**: bản lazy cho ACTIVE nhảy thẳng EXPIRED khi quá grace period, bản cron bắt buộc đi qua PAST_DUE. Giờ chỉ còn **một hàm thuần** `nextSubscriptionStatus(subscription, now)` trong `subscription-status.ts`, có unit test (`subscription-status.spec.ts`). Cron đổi từ 3 `updateMany` viết tay sang: nạp candidate → áp hàm chung → gom theo trạng thái đích → update theo lô.
47. **Hằng số lặp** — `INACTIVE_STATUSES` khai 2 lần y hệt (`auth.service.ts`, `jwt.strategy.ts`) và ~18 chuỗi `'ACTIVE'`/`'DELETED'` rải rác → `src/common/constants/user-status.ts` (`UserStatus`, `INACTIVE_USER_STATUSES`, `SETTABLE_USER_STATUSES`), song song với `location-status.ts` đã có. `MANAGER_SELECT` khai 2 lần → về `locations/location.types.ts`.

**C. Chỗ khó đọc đã viết lại**

48. **`withNestedAttendanceLocation`** — bỏ `Omit<T, typeof KEYS[number]>` + vòng `delete` + 2 lần cast, còn một destructure 4 field rồi spread phần còn lại; TypeScript tự suy ra kiểu trả về. Phải bật `ignoreRestSiblings: true` cho `no-unused-vars` trong `eslint.config.mjs` — chính vì thiếu option đó mà hàm này (và `toPublicUser`) mới bị đẩy sang cách viết cast/delete.
49. **`AuditInterceptor.resolveActor`** — nhánh login trước đây cast từng field khỏi response body (`u.systemRole as string`...), `AuthService` đổi shape là audit ghi sai mà không ai biết. Giờ có `AuditableLoginResponse` (`common/types/login-response.type.ts`), `AuthService.login`/`firebaseLogin` khai bằng `satisfies` → đổi shape là **gãy build**. `toPublicUser` cũng đổi từ `Record<string, unknown>` sang generic giữ nguyên kiểu.
50. **`handleSepayWebhook` không còn biết gì về HTTP** — trước trả `{httpStatus, body}` để controller `res.status()` bằng tay; đó là service **duy nhất** trong repo biết đến HTTP, junior đọc rồi bắt chước là hỏng convention. Giờ: `@HttpCode(200)` trên route, service trả `{success, message?}`, sai API key thì ném `UnauthorizedException` (401). Hành vi với SePay không đổi: mọi trường hợp khác vẫn 200 để nó không retry vào bug của mình.
51. **Tách `subscriptions.service.ts` (525 dòng, gánh 4 việc)** → `SubscriptionService` giữ *trạng thái* (trial, settle, status, requireActive, quota, adminUpgrade — chỉ phụ thuộc Prisma) và `SubscriptionBillingService` giữ *thu tiền* (invoice, QR, webhook). Hai bên gần như không gọi nhau. Chỉ `SubscriptionService` được export ra ngoài module.
52. **`assertQuota`** — tham số `quota` từ union 2 giá trị viết tay đổi thành `QuotaField` suy ra từ schema, thêm quota mới là dùng được ngay. **Sửa luôn một bug**: `max <= 0` coi `0` là "không giới hạn", nên gói cấu hình `maxBranches: 0` (ý là cấm tạo) lại thành tạo thoải mái. Giờ `null` hoặc **số âm** mới là không giới hạn. Ba chỗ ghi snapshot gom về `quotaSnapshotOf(plan)` — thêm quota giờ là 3 chỗ sửa, không phải 4 (mục 31 cũ nói 4).
53. **`daysBetween` dùng `Math.ceil` trên millisecond** → `daysLeft` đổi theo *giờ trong ngày* gọi API (10 ngày 1 tiếng → 11). Thay bằng `wholeDaysBetween` đếm giữa hai mốc nửa đêm UTC, có test.
54. **Descriptor audit không còn phải khai ở `app.module.ts`** — trước là `useFactory` + `inject` liệt kê tay, thêm template mới phải nhớ sửa **2 mảng**, quên thì vẫn compile và âm thầm rơi về mô tả generic. Giờ `@AuditTemplate()` (`DiscoveryService.createDecorator()`), `AuditInterceptor.onModuleInit()` tự quét; module domain chỉ cần khai provider của mình. `AppModule` import thêm `DiscoveryModule`.
55. **Categories: bỏ N+1** — breadcrumb trong `findOne` và `assertNoCycle` mỗi cái query 1 lần/tầng (tối đa 20 query cho 1 request). Giờ nạp cả cây 1 query rồi đi bộ trong bộ nhớ, giống `findTree` vốn đã làm vậy.
56. **Cron: bỏ N+1** — `sendExpiryReminders` tìm chủ cửa hàng bằng 1 `findFirst` cho **mỗi** subscription; giờ 1 query cho cả lô.

57. **Thêm mục `## Coding rules` vào `CLAUDE.md`** (ngay trước `## Architecture`, 25 rule chia 6 nhóm: bảo mật/đúng sai, một-bản-duy-nhất-của-mỗi-luật, phân tầng, kiểu, truy vấn, và checklist trước khi coi là xong). Mỗi rule được viết ra vì **đã có chỗ vi phạm và vi phạm đó im lặng** — phần lớn chính là 17 mục 40–56 ở trên; mỗi rule có ngoặc vuông trỏ về mục Architecture giải thích lý do. Mục đích là lần sau không phải review lại mới phát hiện.

**Đã cân nhắc và cố ý KHÔNG làm** (nêu ra để lần sau khỏi tưởng là bỏ sót):
- `CreateOrderDto` vẫn nhận `status`/`grandTotal`/`customerPay`/`change`/`discountValue` từ client. Khoá lại bây giờ là làm hỏng endpoint: module orders chưa port, **không có gì tính được các số đó** để thay thế. Phải làm cùng lúc với port thật module orders. Các DTO sinh tự động khác nhiều khả năng cùng vấn đề.
- Đổi `tenantId?: string` thành kiểu tường minh (`TenantScope = {all: true} | {tenantId: string}`) để compiler bắt lỗi quên check — đúng nhưng đụng vào 22 module sinh tự động **và** template generator; churn lớn trên code sẽ được sinh lại. Để lại khi port thật từng module.

**Kiểm chứng**: `tsc --noEmit` sạch · `pnpm run lint` sạch · `pnpm run build` sạch · `node scripts/check-permissions.js` OK (3 cặp `subscriptions:*` mới đều có sẵn trong catalog, không phải sửa seed) · unit **8/8** (thêm `subscription-status.spec.ts`) · thêm `test/di-check.e2e-spec.ts` **2/2** — spec này chỉ `.compile()` DI graph, **không cần database**, và kiểm rằng `@AuditTemplate()` thật sự được discovery tìm thấy (nếu không, audit chỉ âm thầm rơi về mô tả generic chứ không lỗi). **Chưa chạy được e2e đầy đủ**: Docker Desktop không chạy trên máy lúc làm, nên các e2e cần Postgres chưa xác minh — chạy lại `docker compose up -d && pnpm run test:e2e` trước khi commit.

### 2026-08-25 — port thật module Product + Inventory

Chủ dự án chốt rút gọn thứ tự build: làm trước nhóm **2 (Staff), 4 (Sản phẩm/kho), 5 (Bán hàng), 6 (Còn lại)**; nhóm 1 (cấu hình nhân sự) và 3 (chấm công/nghỉ phép) để sau. Bắt đầu bằng product + inventory.

**Route đã có** (11 + 4, khớp bản cũ trừ 2 chỗ ghi ở dưới)

58. `products`: `POST/GET/PATCH/DELETE /products`, `GET /products/:id`, `GET /products/search` (tra cứu kiểu POS), `GET /products/items` (danh sách phẳng cho dropdown), `POST /products/:productId/items`, `PATCH|DELETE /products/items/:itemId`, `POST /products/items/:itemId/suppliers`. `inventories`: `GET /inventory`, `PATCH /inventory/:id/min-stock`, `POST /inventory`, `DELETE /inventory/:id` — giữ path `/inventory` số ít như API cũ và như tên resource trong catalog.
59. **Bẫy thứ tự route**: `GET /products/items` và `/products/search` phải khai **trên** `GET /products/:id`, nếu không router hiểu chúng là product id. Đúng cái bẫy mà module Express cũ đã ghi comment cảnh báo.

**Lỗ hổng bản cũ đã vá**

60. **Toàn bộ 11 route product của bản cũ chạy trên `verifyJwt` trần, không có `authorize()` nào.** Bất kỳ tài khoản nào đăng nhập được — kể cả CUSTOMER — đều tạo/sửa/ngừng kinh doanh được cả catalogue của cửa hàng. Resource `products` **đã có sẵn** trong `permissions.json` từ đầu, chỉ là không ai gắn vào route. Giờ đủ `products:create/read/update/delete`.
61. **`createProduct` bản cũ bọc toàn bộ thân hàm trong `if (subscription)`** — tenant không có gói thì hàm trả `undefined` và API trả **HTTP 200**: không tạo gì, không báo gì. Giờ đi qua `assertQuota('quotaSnapshotMaxProducts')`, đếm sản phẩm khác DISCONTINUED; không có gói là 403 rõ ràng.
62. **`categoryName` không còn nhận từ client.** Nó là bản copy denormalized; để client tự khai nghĩa là sản phẩm gắn nhãn danh mục mà nó không thuộc về. Server tự lấy từ `categoryId`, và **`CategoryService.update` giờ cập nhật lại `categoryName` cho mọi sản phẩm khi đổi tên danh mục** — đúng khoản nợ ghi ngày 19/8 ("xử lý khi port module products").
63. **Xoá variant giờ kiểm đủ 4 bảng tham chiếu** (inventory, order item, stock movement item, promotion item), bản cũ chỉ kiểm inventory. Trong Mongo mấy tham chiếu kia chỉ là ref treo; ở Postgres là FK thật, nên check cũ sẽ nổ thành lỗi ràng buộc không nói được gì cho người dùng.
64. **Xoá module `product-items`** (CRUD sinh tự động ở `/product-items`). Để lại là có một đường vòng tạo/xoá variant **không đi qua** kiểm SKU trùng, không đi qua các check ở mục 63. Variant giờ chỉ vào được qua `/products/...`. `Product`/`ProductItem`/`Inventory` đã thêm vào `PORTED_MODELS`.
65. **Quyền inventory**: thêm/gỡ mặt hàng ở một địa điểm bản cũ chặn bằng `role in (TENANT_OWNER, WAREHOUSE_MANAGER)`. Cả role đó lẫn cách chặn theo role đều không còn — giờ là `inventory:create` / `inventory:delete`, tenant tự quyết cấp cho role nào (đúng cách đã thay thế cho việc bổ nhiệm quản lý chi nhánh/kho).

**Dùng chung mới**

66. **`src/common/dto/location-ref.dto.ts`** — Inventory trỏ tới "chi nhánh hoặc kho": Mongo lưu `locationId`+`locationType`, Postgres lưu cặp FK nullable `branch_id`/`warehouse_id`. File này là **chỗ duy nhất** map giữa hai bên, API giữ nguyên cặp cũ nên frontend không phải sửa (cùng kiểu đánh đổi với `attendance-location.dto.ts`). `toLocationColumns` cho write, `toLocationRef` cho response, `locationWhere` cho filter. `LocationRefQueryDto` giữ luật "có locationId thì bắt buộc có locationType", các query DTO ghép bằng `IntersectionType` thay vì chép lại. Có unit test.
67. **`src/common/constants/product-status.ts`** và **`location-type.ts`** — bản cũ chép mảng `["ACTIVE","INACTIVE","DISCONTINUED"]` ở 3 DTO khác nhau. `location-type.ts` cố ý viết thường (`"branch"/"warehouse"`) vì đó đúng là chuỗi frontend đang gửi và đọc.
68. **`NotificationService.managersOfLocation()`** đã port — nhưng đọc `Branch.managerId`/`Warehouse.managerId` thay cho role BRANCH_MANAGER/WAREHOUSE_MANAGER đã bị xoá, và **fallback về chủ cửa hàng** khi địa điểm chưa có quản lý. Bản cũ trả mảng rỗng, tức là cảnh báo tồn kho thấp của một chi nhánh chưa có quản lý gửi cho **không ai cả**.

**Primitive tồn kho (để dành cho Order / StockMovement)**

69. `adjustStock` / `lowStockCrossing` / `notifyLowStock` nằm trong `InventoryService` chứ không nằm ở module gọi nó — "kho thay đổi thế nào và khi nào thì cảnh báo" là **một luật**, chép một bản sang bán hàng và một bản sang chuyển kho là cách chắc chắn để hai bên lệch nhau. Hai điểm phải nhớ khi port Order/StockMovement:
    - `adjustStock` và `initializeStock` nhận **transaction client**, không phải `this.prisma`. Đơn hàng rollback mà kho vẫn bị trừ là failure mode ở đây.
    - `notifyLowStock` gọi **sau khi transaction commit** và không bao giờ ném lỗi. Kho đã trừ, đơn đã xong rồi — lỗi gửi thông báo không được phép làm hỏng ca bán hàng.
70. Luật cảnh báo tách thành hàm thuần `crossedLowStock` (`low-stock.ts`) có unit test riêng, giống cách `nextSubscriptionStatus` đã làm. Nó **edge-trigger**: chỉ bắn đúng bước vượt ngưỡng. Bắn mỗi lần `stock <= minStock` nghĩa là mỗi lần bán tiếp một món đang thiếu lại bắn thêm một cái, và quản lý tắt noti ngay ngày đầu — lúc đó cảnh báo thật cũng không ai thấy nữa. Test viết theo đúng failure mode đó.

**Đổi API mà frontend sẽ thấy** (cần báo team FE)

71. `DELETE /products/:id/delete` → **`DELETE /products/:id`**, và `DELETE /products/items/:itemId/delete` → **`DELETE /products/items/:itemId`**. Hậu tố `/delete` không chỗ nào khác trong cả hai codebase dùng. Nếu FE chưa sửa kịp thì nói, thêm lại alias không tốn gì.
72. `VAT` → `vat` trong request/response của variant, khớp tên cột.
73. `GET /inventory` trả `location: {locationId, locationType}` (object) thay vì hai field phẳng `locationId`/`locationType` ở gốc như bản cũ.

**Kiểm chứng**: `tsc --noEmit` sạch · `pnpm run lint` sạch · `pnpm run build` sạch · `node scripts/check-permissions.js` OK (không phải sửa seed — `products:*` và `inventory:*` đã có đủ trong catalog) · unit **22/22** (thêm `low-stock.spec.ts` và `location-ref.spec.ts`) · `test/di-check.e2e-spec.ts` 2/2, đã thêm assert cho `ProductService`/`InventoryService`.

**CHƯA chạy được với database thật** — Docker Desktop vẫn không chạy trên máy (lần thứ hai, sau đợt 20/8). Nghĩa là **chưa có dòng nào của module này chạm vào Postgres thật**: chưa verify được quota, transaction tạo sản phẩm + variant + tồn kho ban đầu, cross-tenant 404, hay filter `isLowStock` (dùng field-reference của Prisma `stock <= minStock` — đây là chỗ tôi ít chắc nhất, nó compile được nhưng chưa từng chạy). Việc đầu tiên của phiên sau: `docker compose up -d && pnpm run test:e2e`, rồi test tay theo kịch bản như đợt 19/8.

### 2026-08-25, phần 2 — port thật Staff (5 route còn thiếu) + Stock Movement

**Staff — 5 route còn thiếu, gắn vào module `users`**

74. `POST|PATCH /users/:id/leave-balance`, `POST /users/:id/account`, `PATCH /users/:id/account/password`, `PATCH /users/:id/account/deactivate`. Giữ nguyên sub-path cũ, chỉ đổi tiền tố `/staff` → `/users` (đã đổi từ 17/8). Quyền dùng **`users:update`** chứ không phải `staff:update`: catalog có cả hai resource cho cùng một thứ, mà module này xưa nay check `users` — để hai resource song song chính là cách một quyền bị cấp ở chỗ này nhưng kiểm ở chỗ kia. `staff:*` giờ là legacy.
75. **`GET /staff/roles` không port lại.** Nó trả enum role cố định mà người gọi được phép gán; role giờ là dòng dữ liệu do tenant tự định nghĩa nên câu trả lời đúng là `GET /roles`.
76. **Phần lớn `StaffService` cũ (1129 dòng) là plumbing phân cấp role** — ai được sửa ai, theo BRANCH_MANAGER / WAREHOUSE_MANAGER / STAFF. Không port dòng nào: các role đó đã bị xoá từ đợt RBAC, "ai được sửa nhân viên" giờ là đúng một quyền.
77. **Xoá nhân viên giờ ẩn danh dữ liệu** (`anonymizeDeletedStaff` bản cũ): giữ dòng (orders/attendances/payslips/audit log đều trỏ FK vào) nhưng xoá dữ liệu cá nhân, và `phoneNumber` thành `deleted_<id>` — nó là handle đăng nhập, để nguyên là **không bao giờ tuyển lại được người đó bằng số cũ**. Lần port NestJS trước rút gọn hàm này còn mỗi việc đổi status; giờ đã đủ, kèm `deletedById` + `deletionReason` (2 cột có sẵn mà chưa ai ghi).
78. **Vô hiệu hoá tài khoản xoá luôn password** ngoài việc đổi status, nên token đang cầm bị chặn ngay request kế tiếp (INACTIVE nằm trong `INACTIVE_USER_STATUSES`).
79. **Hai guard chung cho cả deactivate và delete**: (a) không được đang là người nhận bàn giao của đơn nghỉ còn hiệu lực; (b) không được đang là quản lý của chi nhánh/kho. Bản cũ nhận `replacementManagerId` rồi tự swap quản lý ngay trong hàm; giờ việc bổ nhiệm là `PATCH /branches/:id/manager`, nên ở đây **từ chối và chỉ sang đó** — một luật bổ nhiệm, một chỗ.
80. **Leave balance**: `remainingDays` được **tính lại** = hạn mức mới − số ngày đã dùng, không ghi đè, nên nâng quota giữa năm không trả lại ngày đã nghỉ. `POST` (khởi tạo) chỉ hợp lệ khi chưa dùng ngày nào. Cả hai đường ghi đều qua `updateMany` có điều kiện giá trị cũ — hai quản lý sửa cùng lúc, hoặc sửa lúc đơn nghỉ vừa duyệt, sẽ 409 thay vì đè lên nhau (đúng trick `SupplierService.payDebt`). Thêm chặn trên `Max(365)` — DTO cũ nhận mọi số nguyên không âm nên gõ nhầm là ai đó có 3650 ngày phép.

**Stock Movement — 10 route, đủ máy trạng thái**

81. `POST`, `GET`, `GET /:id`, `PATCH /:id/{details,open,close,ship,receive,approve-adjust,cancel}` tại `/stock-movements`, đúng path và đúng quyền bản cũ (`approve` cho ship + duyệt kiểm kê, `receive`, `cancel`). **Không có DELETE** — phiếu là chứng từ về hàng đã đi thật, chỉ huỷ chứ không xoá. Cặp `stock_movement:delete` mà CRUD sinh tự động đẻ ra giờ thành không dùng.
82. **4 loại phiếu, 2 dạng vòng đời**: `EXPORT`/`RETURN` (giữa 2 địa điểm của mình) đi `DRAFT → OPENING → CLOSED → IN_TRANSIT → RECEIVED`; `IMPORT` (từ NCC) và `ADJUST` (kiểm kê tại 1 địa điểm) mở thẳng ở `PENDING` vì không có gì để soạn hàng, và `ADJUST` kết thúc ở `COMPLETED` chứ không phải `RECEIVED` vì chẳng có gì tới nơi.
83. **Kho chỉ đổi ở 4 chỗ**: `ship` trừ nguồn (chỉ phiếu chuyển), `receive` cộng đích theo số **thực nhận** (giao thiếu là bình thường, phần thiếu đơn giản là không cộng), `approve-adjust` áp `thực đếm − hệ thống`, `cancel` trả lại phần `ship` đã trừ nếu phiếu còn IN_TRANSIT. Cả 4 đều ghi kho và ghi status **trong cùng một transaction**, và bắn thông báo **sau khi commit**.
84. **Hạn mức công nợ NCC đã được kiểm — đúng khoản nợ ghi từ 19/8.** Kiểm ở 3 chỗ: lúc tạo phiếu, lúc sửa details, và **lại lần nữa bên trong transaction nhận hàng** sau khi cộng nợ (nhiều phiếu nhập có thể mở cùng lúc với một NCC, chỉ phiếu thật sự về mới tính; vượt ở đây thì ném lỗi và rollback cả phiếu nhận). `creditLimit <= 0` nghĩa là không giới hạn, khớp cách seed.
85. **Cảnh báo 75% hạn mức** tách thành hàm thuần `crossedCreditWarning` có unit test riêng, **edge-trigger** y hệt `crossedLowStock`: chỉ bắn đúng phiếu vượt ngưỡng, không bắn mỗi phiếu nhập sau đó. Đây là lần thứ hai áp cùng một khuôn — nếu sau này có cảnh báo ngưỡng thứ ba thì làm y như vậy.
86. **Phân quyền theo địa điểm là THAY THẾ, không phải port.** Bản cũ rẽ nhánh theo BRANCH_MANAGER / WAREHOUSE_MANAGER và theo `managedScheduleAccess` (quyền tạm do lịch làm việc cấp). Không cái nào còn: 2 role đã xoá, còn module WorkingSchedule nằm trong nhóm hoãn. Thay bằng: TENANT_OWNER thao tác được mọi địa điểm của tenant, STAFF thao tác được đúng nơi mình trực thuộc (`User.branchId`/`warehouseId`). **`canActAt()` là seam duy nhất** — khi port WorkingSchedule thì nới đúng chỗ đó, không đụng gì khác.
87. Hai luật theo role bị **bỏ hẳn thay vì dịch**: "branch manager không được tạo IMPORT" (giờ là chuyện ai được cấp `stock_movement:create`) và "branch manager không được EXPORT về kho" — cái sau sống sót dưới dạng luật về chính cái phiếu: chi nhánh → kho là RETURN, ai làm cũng vậy (`assertTransferMakesSense`).
88. `OPEN_MOVEMENT_STATUSES` (danh sách trạng thái "phiếu chưa xong") giờ khai một lần ở `stock-movement.constants.ts`; `ProductService` (chặn ngừng kinh doanh sản phẩm đang nằm trong phiếu dở) import từ đó thay vì giữ bản chép riêng — bản chép đó tôi vừa tạo hôm nay ở mục 63, gom lại luôn trước khi nó kịp lệch.
89. `StockMovementRequest` đã thêm vào `PORTED_MODELS`. `NotificationService.managersOfLocation` (port hôm nay ở mục 68) được dùng thật ở đây — thông báo đi tới quản lý địa điểm gửi/nhận, và **người bấm nút luôn bị loại khỏi danh sách nhận**: không ai cần được báo về việc mình vừa làm.

**Kiểm chứng**: `tsc --noEmit` sạch · `pnpm run lint` sạch · `pnpm run build` sạch · `node scripts/check-permissions.js` OK (không phải sửa seed) · unit **28/28** (thêm `credit-warning.spec.ts`) · di-check 2/2, đã thêm assert cho `StockMovementService` và `UserService`.

**Vẫn CHƯA chạm database thật** — Docker Desktop vẫn không chạy (lần thứ ba). Với stock movement thì đây là thiếu sót nặng hơn hẳn product/inventory: **toàn bộ máy trạng thái, mọi transaction cộng/trừ kho, và cả 3 điểm kiểm hạn mức công nợ đều chưa từng chạy một lần nào.** Đừng commit trước khi test tay đủ 4 loại phiếu qua từng bước.

### 2026-08-25, phần 3 — review đối chiếu bản cũ rồi sửa những gì lệch

Đọc lại 4 module vừa port và so từng luồng với `iKiotMS-BE`. Review nêu 3 lỗi thật, 8 đổi hành vi chưa báo, 2 chỗ nới quyền, 3 chỗ thiếu. Chủ dự án chọn sửa: 1.1, 1.3, revert 2.5 + 2.6, và bù 5.2 + 5.3.

90. **`PATCH /users/:id` từng đi vòng qua toàn bộ guard vô hiệu hoá tài khoản.** `UpdateUserDto` nhận `status` và `update()` ghi thẳng, nên set `INACTIVE` qua đây **bỏ qua** cả 3 thứ mới thêm hôm nay: không kiểm người đang nhận bàn giao, không kiểm đang là quản lý chi nhánh/kho, **không xoá password** (bật lại là đăng nhập được bằng mật khẩu cũ). Bản cũ `updateStaff` **cấm hẳn** field này — `if (Object.hasOwn(data, "status")) throw` — chính là để bắt đi qua route deactivate. Đã bỏ `status` khỏi DTO. Vòng đời tài khoản giờ chỉ đi qua `POST /users/:id/account` và `PATCH /users/:id/account/deactivate`.
91. **`adjustStock` trả lại tính nguyên tử.** Bản cũ là `findOneAndUpdate({$inc}, {upsert:true})` — một lệnh. Bản tôi viết là `findFirst` → `create`/`update`, có khe hở: hai lần nhận hàng đồng thời vào một địa điểm **chưa từng có** mặt hàng đó, cả hai đọc ra null, cả hai insert, một cái chết vì unique index. Giờ dùng `upsert`. **Phải chọn đúng 1 trong 2 unique index tuỳ đầu nào được set** — trong Postgres unique index có cột NULL thì không ràng buộc gì, nên `(tenant, branch, item)` chỉ có tác dụng với dòng chi nhánh và `(tenant, warehouse, item)` chỉ với dòng kho.
92. **Revert 2 response về đúng bản cũ**: `DELETE /inventory/:id` trả `{success: true}` (không phải `{id, removed}`), và 2 route leave-balance trả `{message, data, leaveBalance}` (không phải `{user, leaveBalance}`).
93. **`GET /users` giờ có phân trang + filter** như `getStaffList` cũ: `page`/`limit`/`search`/`status`/`roleId`/`branchId`/`warehouseId`, trả envelope `{data, pagination}`. Trước đó trả **toàn bộ nhân viên, không phân trang, không filter** — tenant vài trăm người là payload không dùng được. Giữ 2 luật của bản cũ: **chỉ hiện tài khoản STAFF** (chủ cửa hàng không nằm trong danh sách nhân viên của chính mình) và **loại chính người gọi** ra khỏi danh sách. Đổi tên tham số `recordPerPage`→`limit`, `keyword`→`search` cho khớp 5 list endpoint đã port khác; `role` (enum cũ) → `roleId` (uuid, vì role giờ là dữ liệu).
94. **`PATCH /users/:id` giờ sửa được cả hồ sơ** — email, `hireDate`, `paysheetId`, `accountNote` và object `profile` lồng (firstName, lastName, avatarUrl, dob, taxNumber, identificationId, address, gender). Trước đó chỉ có 4 field, hồ sơ nhân viên **không có đường nào vào cả**. `paysheetId` phải là bảng lương ACTIVE của tenant (port `validatePaySheetAssignment`).
95. **Port `normalizeWorkplaceUpdateData`**: gửi `branchId` thì tự null `warehouseId` và ngược lại; gửi cả hai là 400. Thiếu nó thì một PATCH chỉ gửi một nửa sẽ để lại nơi làm việc cũ → dòng dữ liệu khai 2 nơi làm việc, và lần sửa **sau** mới báo lỗi, đổ tội cho người sửa sau.
96. **Port validator CCCD** thành hàm thuần `validateVietnamIdentificationId` có unit test (`src/modules/users/vietnam-identification.ts`): 12 chữ số, mã tỉnh nằm trong danh sách 63 mã, và **thế kỷ/năm sinh + giới tính mã hoá trong số CCCD phải khớp `dob`/`gender` của hồ sơ**. Cả ba field đều có thể là field đang được sửa nên kiểm trên kết quả đã merge, đúng như bản cũ. Đây là rule đáng giá: CCCD, ngày sinh và giới tính đều chảy xuống bảng lương và export bảo hiểm xã hội, sai ở đó là chuyện của người khác.
97. **Kiểm trùng email + CCCD** khi sửa (port `checkStaffUniqueness`). **Một điểm cố ý khác bản cũ**: bản cũ kiểm CCCD trùng **toàn hệ thống, không lọc tenant** — hợp lý cho một số định danh quốc gia, nhưng nghĩa là cửa hàng A dò được cửa hàng B có tuyển một người cụ thể hay không. Đã thu về phạm vi tenant.
98. `SELECT_SAFE` mở rộng thêm các cột vừa cho sửa (profile\*, hireDate, paysheetId, accountNote) — nếu không thì PATCH xong response không hiện thứ vừa ghi.

**Chưa sửa (review có nêu, chủ dự án chưa chọn)**: 1.2 (`findOne` không loại DELETED — nhưng bỏ `status` khỏi DTO ở mục 90 đã chặn đường hồi sinh tài khoản đã xoá, còn lại là sửa được roleId/posting của một dòng đã xoá), 2.1–2.4 và 2.7–2.8 (đổi default limit, thêm sort, filter `locationType` đơn lẻ, đổi shape response stock-movement), 3.x (các chỗ siết chặt hơn bản cũ), 4.x (bên nhận huỷ được phiếu; `approveAdjust` bắn cảnh báo tồn kho), 5.1 (revoke refresh token khi xoá/vô hiệu hoá — chờ Redis).

**Còn thiếu ở nhánh tạo tài khoản**: validator số điện thoại VN của bản cũ (`validateStaffPhoneNumber` — chặn đầu số VoIP/vệ tinh/mạng dùng riêng, tổng đài khẩn cấp) chưa port; `CreateUserDto` vẫn chỉ có `@MinLength(8)`, tức là nhận `"abcdefgh"`. Nằm ở nhánh create nên để ngoài phạm vi lần sửa này.

**Kiểm chứng**: `tsc` · `lint` · `build` · `check-permissions` sạch · unit **42/42** (thêm `vietnam-identification.spec.ts`) · di-check 2/2. **Vẫn chưa chạm database thật** — Docker vẫn không lên.

### 2026-08-25, phần 4 — validator số điện thoại + **chạy thật trên Postgres lần đầu**

99. **Port `validateStaffPhoneNumber`** thành hàm thuần `validateVietnamPhoneNumber` có unit test (21 case): đầu số nhà mạng hợp lệ, và chặn riêng từng dải trông giống di động nhưng không thể là — VoIP 065, vệ tinh 067, khối 069 của cơ quan nhà nước, 080, và tổng đài 111–115, **mỗi dải một message riêng** (báo "số điện thoại không hợp lệ" cho một số 113 đang hoạt động thì người nhập không hiểu sai ở đâu). Dải khẩn cấp kiểm **trước** luật 10 chữ số, nếu không thì message "phải đủ 10 chữ số" bắn trước và giải thích nhầm. Bỏ `@MinLength(8)` khỏi `CreateUserDto.phoneNumber` — nó nhận `"abcdefgh"`.

**Docker đã lên. Đây là lần đầu code của 3 đợt port hôm nay chạm database thật.**

100. **Thêm `test/smoke.e2e-spec.ts`** — 13 test, 46 assertion, chạy trên Postgres thật: đăng ký tenant → trial → chi nhánh/kho/NCC → sản phẩm 2 biến thể + tồn kho đầu kỳ → toàn bộ máy trạng thái chuyển kho. **Tự dọn sạch dữ liệu nó tạo ra** (đã verify DB không còn dòng thừa), nên chạy lại bao nhiêu lần cũng được — giữ đúng tính chất đó nếu viết thêm.
101. **Hai chỗ tôi lo nhất đều chạy đúng**: (a) `isLowStock` dùng Prisma field reference (`stock <= minStock`) — lọc đúng 1 dòng tồn 8/ngưỡng 10; (b) `adjustStock` bản `upsert` **tạo được dòng tồn kho chưa tồn tại** khi nhận hàng nhập (kho 0 → 60).
102. **Số học tồn kho đúng qua cả vòng đời**: xuất 20 (kho 50→30) → nhận thiếu 18/20 (chi nhánh 8→26) → huỷ phiếu đang IN_TRANSIT trả lại kho (25→30) → kiểm kê đếm 24 vs hệ thống 26 → duyệt (chi nhánh 26→24). Chặn xuất quá tồn (400), chặn ship từ DRAFT (409).
103. **Hạn mức công nợ đúng cả 3 điểm kiểm**: tạo phiếu 15tr > hạn mức 10tr → 400; nhận 60 × 130k → công nợ đúng 7.800.000; giá nhập > giá bán lẻ → 400.
104. **Cảnh báo 75% hạn mức**: lúc đầu test fail và **hoá ra tôi test sai, không phải code sai** — chủ cửa hàng tự nhận hàng thì người nhận thông báo duy nhất lại chính là người vừa bấm, bị lọc ra, nên không gửi gì. **Bản cũ hành xử y hệt** (`ownerIdsFiltered.length > 0`). Đã sửa test: cho nhân viên nhận hàng → chủ cửa hàng nhận đúng 1 thông báo; và phiếu nhận **thứ hai** trên ngưỡng vẫn chỉ 1 thông báo, đúng tính edge-trigger.
105. **Phân quyền theo địa điểm chạy đúng**: nhân viên chi nhánh chỉ thấy phiếu của chi nhánh mình, tạo phiếu xuất từ kho khác → 403, gọi `/products` khi role không có `products:read` → 403.
106. **Transaction tạo sản phẩm rollback sạch**: tạo sản phẩm có SKU trùng → 409 và **không để lại nửa sản phẩm** nào trong DB.
107. Thêm override ESLint cho `test/**/*.e2e-spec.ts`: tắt nhóm `no-unsafe-*`. Body của response supertest là `any` theo bản chất và assert lên nó chính là việc của e2e test — ép kiểu từng dòng chỉ làm assertion khó đọc chứ không an toàn hơn. Code trong `src/` giữ nguyên đủ luật.

**Kiểm chứng**: `tsc` · `lint` · `build` · `check-permissions` sạch · unit **63/63** · **e2e 17/17 trên Postgres thật** · DB không còn dữ liệu test.

**Quan sát nhỏ, chưa xử lý**: chạy e2e có warning `pg` — *"Calling client.query() when the client is already executing a query is deprecated"*. Không làm fail test, nhiều khả năng đến từ các cặp `Promise.all([findMany, count])` dùng chung một connection qua driver adapter. Đáng xem lại khi nâng `pg` lên 9.

### 2026-08-26 — port thật Order + Promotion (+ Customer)

Nhóm 5. Ba module đi cùng nhau: giỏ hàng được `promotions` tính giá, `orders` chốt đơn, gắn vào một dòng `customers`.

**Route** (12 + 9 + 6)

108. `orders`: `POST`, `GET`, `GET /:id`, `PATCH /:id/status`, `POST /:id/pay-offline`, và `POST /webhook/sepay/order` (public). **Không có DELETE** — đơn sai thì CANCELLED hoặc RETURNED, cả hai đều để lại dấu vết.
109. `promotions`: CRUD + `GET /:id/logs` + 3 endpoint giỏ hàng `POST /promotions/{candidates,calculate,apply}`. Chỉ `/apply` ghi dữ liệu.
110. `customers`: CRUD + `DELETE /customers` hàng loạt. Xoá mềm (`isDeleted`) vì đơn hàng trỏ FK vào.
111. **Xoá module `promotion-logs` sinh tự động** — cùng lý do đã xoá `product-items`: nó mở `/promotion-logs` CRUD, tức là một đường ghi log sử dụng khuyến mãi **không đi qua** `/promotions/apply` và các hạn mức ở đó.

**Lỗ hổng đã vá**

112. **Tổng tiền đơn hàng giờ do server tính, không nhận từ client.** Bản cũ lấy `grandTotal` thẳng từ body rồi lưu — một request tự chế là quét cả giỏ hàng với giá 0. Đây chính là khoản nợ CLAUDE.md ghi từ lúc dựng CRUD sinh tự động, giờ trả xong. `grandTotalOf` = tổng dòng − giảm giá từng dòng − giảm giá `ORDER` thủ công. Giảm giá kiểu `PROMOTION` **không trừ lần nữa**: engine đã rải nó vào từng dòng rồi, `discountValue` chỉ là con số ghi lại. `status`/`change`/`paymentReference` cũng do server quyết.
113. **6 route customer của bản cũ chạy `verifyJwt` trần, không `authorize()`** — ai đăng nhập cũng đọc và xoá được toàn bộ danh sách khách hàng. Resource `customers` đã thêm vào catalog từ đợt RBAC đúng để vá chỗ này, giờ mới gắn thật.
114. `customerPay < grandTotal` giờ bị chặn ở cả tạo đơn lẫn `pay-offline` — chênh lệch giữa "tiền thối" và một khoản hụt âm thầm vào doanh thu.

**Pricing engine**

115. **`pricing-engine.ts` không chạm database** — port đúng cấu trúc bản cũ (`PricingEngine.js` vốn đã thuần), thành hàm thuần có **26 unit test**. Mọi luật về tiền nằm ở đó; service lo phần tra cứu: khuyến mãi ứng viên, category của từng dòng giỏ (biến thể không mang category, sản phẩm cha mới mang), và số lần khách đã dùng.
116. **Áp khuyến mãi luôn là tường minh** — caller truyền đúng id người dùng bấm; engine không bao giờ tự đoán tổ hợp "tốt nhất", và một khuyến mãi được chọn nhưng không đủ điều kiện là **400 chứ không im lặng bỏ qua** (bỏ qua nghĩa là thu của khách nhiều hơn số hiện trên màn hình).
117. **Tối đa 2 khuyến mãi, và phải cùng stackable**; discount **tích luỹ** trên mỗi dòng bị kẹp lại bằng giá dòng đó. Thiếu cái kẹp này thì 2 khuyến mãi cùng trúng một SKU sẽ giảm quá giá và đơn hàng thành nợ tiền khách. Có test riêng cho đúng tình huống đó.
118. **Hạn mức lượt dùng kiểm lại BÊN TRONG transaction** ở `/apply`: hạn mức tổng bằng `updateMany` có điều kiện (chỉ tăng khi còn chỗ), hạn mức theo khách bằng đếm lại log, và `@@unique([orderId, promotionId])` làm chốt chặn cuối. Số đọc trước đó có thể đã cũ — hai quầy, hoặc một khách mở hai tab.

**Dòng tiền & SePay**

119. **Bán tiền mặt có thối là 2 dòng cash flow**, không phải 1: ngăn kéo thật sự nhận cả tờ tiền và thật sự thối lại, kiểm quỹ cuối ca phải khớp cả hai. **Chỉ dòng INCOME mang `orderId`** — `@@unique([orderId, flowType])` phải để trống chỗ cho dòng EXPENSE mà lần RETURN sau này ghi. Bản cũ cũng để dòng thối không gắn orderId; nhìn như sơ suất nhưng không phải.
120. **`SepayOrderService` tách hẳn khỏi `SepaySubscriptionService`** đúng như CLAUDE.md cảnh báo từ đợt subscription: bên kia trả vào tài khoản của iKiot lấy từ env, bên này trả vào tài khoản **của từng tenant** lấy từ cột `banking.*`, và **khoá webhook chính là cách nhận diện tenant**. Gộp lại nghĩa là credential của tích hợp này thanh toán được hoá đơn của tích hợp kia.
121. Webhook trả 200 cho mọi trường hợp để SePay không retry, và **log cảnh báo** khi tiền về cho đơn đã thanh toán bằng cách khác — chỗ đó cần hoàn tiền thủ công.

**Hai thay thế do RBAC**

122. Phạm vi xem khuyến mãi: bản cũ rẽ theo BRANCH_MANAGER/STAFF; giờ là "TENANT_OWNER thấy hết, STAFF thấy khuyến mãi toàn hệ thống + khuyến mãi của chi nhánh mình". Luật "branch manager chỉ được tạo khuyến mãi cho chi nhánh mình" bỏ theo role — tạo được hay không là chuyện ai giữ `promotions:create`.
123. Thông báo đơn đã thanh toán: bản cũ emit vào room `order:<id>` mà client tự join. Cơ chế đó **đã bị gỡ như một bản vá bảo mật** (xem CLAUDE.md "Realtime"), nên giờ emit vào `tenant:<id>` kèm orderId trong payload để client tự lọc.

**Kiểm chứng — chạy thật trên Postgres**: `tsc` · `lint` · `build` · `check-permissions` sạch · unit **89/89** (thêm 26 test pricing engine) · **e2e 26/26**, smoke suite mở rộng thêm 9 kịch bản: tính tổng server-side, chặn bán quá tồn, RETURN trả lại kho + ghi dòng hoàn tiền, SEPAY mở PENDING → `pay-offline` → chặn thu hai lần, webhook (khoá sai / trích ref từ text tự do / chặn replay), tính giá có cap, `/apply` tăng `usedCount` + ghi log, chặn dùng quá hạn mức, phạm vi chi nhánh, khách vãng lai tự tạo, xoá mềm khách hàng. DB sạch sau khi chạy.

### 2026-08-26, phần 2 — review đối chiếu bản cũ rồi sửa

Review nêu 3 lỗi thật, 6 chỗ siết chặt chưa ghi, 7 đổi response, 3 yếu điểm kế thừa. Chủ dự án chốt: **sửa lỗi, giữ nguyên phần đổi response (không ảnh hưởng logic/nghiệp vụ), và làm cho đúng phần yếu điểm.**

**Lỗi**

124. **`@Permissions` giờ nhận nhiều action với nghĩa "hoặc"** — `@Permissions('orders', 'update', 'pay_offline')`. Bản cũ là `authorize("orders", ["update","pay_offline"])` và middleware giải bằng `actions.some(...)`, tức là **có một trong hai là đủ**; tôi port thành mỗi `pay_offline` nên một role đang có `orders:update` sẽ mất quyền sau khi lên bản mới. Đã sửa cả decorator, guard, và regex trong `scripts/check-permissions.js` (mọi action liệt kê vẫn phải có trong catalog).
125. **Tách `can(user, resource, action)`** ra `common/utils/permission.ts` — đúng luật guard đang dùng, để service hỏi được. Cần vì có quyết định guard không làm được: vào được `GET /orders` là `orders:read`, nhưng **thấy bao nhiêu** mới là `orders:view_all`. Guard giờ gọi chung hàm này, không tự lặp lại phần short-circuit ADMIN/TENANT_OWNER nữa.
126. **`appliedPromotions[].promotionId` giờ kiểm tenant.** `OrderAppliedPromotion.promotionId` là FK thật, nên id khuyến mãi của tenant khác vẫn qua được FK và **liên kết dữ liệu hai tenant với nhau**. Ở Mongo nó chỉ là ref treo nên không ai để ý.
127. Bỏ mảng `crossings` chết trong `updateStatus` — khai rồi không bao giờ push, gọi `notifyLowStock([])`. Thay bằng comment nói rõ **vì sao** không cần: huỷ/hoàn chỉ làm kho tăng, mà tăng thì không thể tụt qua ngưỡng.

**Yếu điểm kế thừa — làm cho đúng**

128. **`InventoryService.deductStock`** — trừ kho có chốt `stock: { gte: quantity }` **ngay trong lệnh UPDATE**. Trước đó (và ở bản cũ) là đọc mức tồn rồi trừ sau: hai quầy cùng thấy còn 1 món, cùng bán, kho xuống âm. Giờ `updateMany` hoặc khớp và trừ nguyên tử, hoặc không khớp — và "không khớp" chính là câu trả lời cho "có đủ hàng không". **Áp cho cả bán hàng lẫn `ship` phiếu chuyển kho** — cùng một luật, một chỗ. Các lệnh `assertSourceStock`/`assertStockCovers` còn lại giờ chỉ là báo sớm cho người dùng, không phải chỗ chặn.
129. **Khách vãng lai: `upsert` trong transaction.** Hai vấn đề cùng lúc — (a) tạo trước khi validate xong nên đơn lỗi vẫn để lại dòng khách, (b) find-then-create nên hai đơn vô danh đồng thời tạo **hai** dòng khách vãng lai. Giờ giải trong transaction bằng `upsert`, dựa trên index mới.
130. **Migration `20260826050000_customer_code_unique_per_tenant`** — `@@unique([tenantId, customerCode])`. Viết tay vì `prisma migrate dev` cần terminal tương tác (môi trường này không có), rồi `prisma migrate deploy`. Cột nullable nên Postgres chỉ ràng buộc dòng **thực sự có mã** — đúng luật cần: bao nhiêu khách không mã cũng được, không bao giờ hai khách chung một mã. Đây cũng là index cho phép `upsert` ở mục 129, và nó biến việc kiểm trùng `customerCode` ở tầng app thành có bảo chứng dưới DB.
131. **`GET /orders` và `GET /orders/:id` giờ giới hạn theo chi nhánh** — nhân viên thấy đơn của chi nhánh mình, `orders:view_all` mở ra toàn tenant (chủ/admin luôn qua). Bản cũ **không giới hạn gì**: thu ngân chi nhánh A đọc được toàn bộ doanh thu chi nhánh B. `orders:view_all` nằm trong catalog từ đầu mà không ai dùng — đọc đúng như luật định làm mà chưa nối. Giờ khớp với `stock-movements`, hai màn hình cạnh nhau mà hành xử khác nhau thì tự nó là một bug report.

**Giữ nguyên theo yêu cầu**: phần đổi response (mất field `name` của nhân viên, `GET /customers` giới hạn 10 đơn/khách, limit mặc định 20→10, `qrUrl: null` thay vì bỏ field, status 400→409, `productName` lấy từ DB) — đều không đổi logic hay nghiệp vụ. 6 chỗ siết chặt hơn bản cũ cũng giữ, giờ đã ghi vào CLAUDE.md.

**Kiểm chứng**: `tsc` · `lint` · `build` · `check-permissions` sạch · unit **89/89** · **e2e 30/30 trên Postgres thật**. Smoke thêm 4 kịch bản đúng vào các fix: đơn mang khuyến mãi của tenant khác → 404; nhân viên `GET /orders` chỉ thấy chi nhánh mình còn chủ thấy hết; bán vượt tồn 1 đơn vị → 400 **và tồn kho không suy suyển** (chốt nằm trong UPDATE); **3 đơn vô danh chạy song song → đúng 1 dòng khách vãng lai**.

### 2026-08-26, phần 3 — port thật Cash Drawer (nốt nhóm 5)

**Một lỗi schema phải sửa trước khi port**

132. **Index `(tenant_id, branch_id, status)` là unique ĐẦY ĐỦ, không phải partial.** Schema đã ghi chú "partial: WHERE status = 'OPEN' — add via follow-up migration edit" nhưng migration init tạo ra bản đầy đủ. Nghĩa là mỗi chi nhánh chỉ **đóng ca được đúng một lần trong đời** — ngày thứ hai gọi `finalize` sẽ nổ unique violation. Đây là loại lỗi chỉ lộ ra ở ngày thứ hai chạy thật.
    Migration `20260826060000_cash_drawer_single_open_session`: DROP index cũ, CREATE unique **partial** `WHERE status = 'OPEN'`. Đã gỡ `@@unique` khỏi `schema.prisma` vì Prisma không diễn đạt được WHERE — kèm cảnh báo trong schema: lần `prisma migrate dev` sau sẽ đề nghị xoá index này, **phải sửa migration sinh ra chứ đừng cho chạy thẳng**.

**Module** (6 route, đúng path và đúng quyền bản cũ)

133. `POST /cash-drawer-sessions` (open), `GET /current`, `GET`, `GET /:id`, `POST /:id/shift-logs`, `POST /:id/finalize`. **Không có PATCH/DELETE** — ca quầy là chứng từ tiền bạc, chỉ mở/ghi/chốt chứ không sửa. Ba route đọc dùng `@Permissions('cash_drawers', 'read', 'read_own')` — đúng dạng "hoặc" của `authorize(["read","read_own"])` bản cũ, nhờ mục 124 hôm nay.
134. **`businessDate()` tách thành hàm thuần có 6 unit test.** Ngày kinh doanh là ngày **theo giờ cửa hàng** (`Asia/Ho_Chi_Minh`), không phải UTC — trả về nửa đêm UTC của ngày đó để cột `date` của Postgres không trôi. Tính theo UTC thì mọi ca mở trước 07:00 giờ VN bị tính sang doanh thu hôm trước; sai kiểu này không ai thấy cho tới lúc kiểm quỹ lệch hẳn một ca.
135. **Trình tự phiếu ca được kiểm chứ không tin.** `START` chỉ hợp lệ khi là phiếu đầu tiên, hoặc ngay sau một `END` có ghi tên chính người này nhận bàn giao. `END` chỉ hợp lệ từ đúng người đã ghi `START` tương ứng. Và **chỉ người đang giữ quầy mới ghi được**. Không có mấy luật đó thì hai thu ngân cùng khai đã giữ quầy trong một khoảng, và khi thiếu tiền thì không quy được cho ca nào.
136. `END` có `nextStaffId` = bàn giao: quầy sang tay người đó, ca vẫn mở. `END` không ghi tên ai = ca cuối ngày, và đó là điều kiện để `finalize`. Mọi lệnh ghi đều chốt trên `updatedAt` vừa đọc — một phiếu chen ngang sẽ làm phần kiểm trình tự phía trên thành cũ, và mất một lần bàn giao nghĩa là cái quầy không ai đứng tên.
137. **Phân quyền thay thế** như mọi chỗ dính role cũ: chi nhánh lấy từ nơi nhân viên trực thuộc (chủ cửa hàng không trực thuộc đâu nên phải khai, và không được âm thầm đổi hướng sang chi nhánh khác), còn `cash_drawers:read` vs `read_own` quyết định thấy cả chi nhánh hay chỉ những ca mình làm. Hai cặp quyền này nằm trong catalog từ đợt RBAC mà chưa ai dùng — đây đúng là chỗ chúng sinh ra để dùng.

**Kiểm chứng**: `tsc` · `lint` · `build` · `check-permissions` · `migrate status` sạch · unit **95/95** · **e2e 33/33 trên Postgres thật**.

Smoke thêm 3 kịch bản chạy trọn một ngày quầy: mở ca → mở ca thứ hai cùng chi nhánh **409** → thu ngân chưa từng giữ quầy không thấy nổi ca (**404**) → `END` trước `START` **409** → `START` hai lần **409** → chốt giữa ca **409** → **bàn giao** sang thu ngân 2 (ca vẫn OPEN, người cũ hết quyền ghi → 403) → thu ngân 2 làm và kết ca → `finalize` (CLOSED, 4 phiếu ca) → `finalize` lần hai **409** → **mở được ca mới sau khi ca cũ đóng** (đúng thứ trước mục 132 làm không được) → `read_own` chỉ thấy ca mình làm, chủ thấy cả hai.

**Một test của tôi sai chứ không phải code**: ban đầu tôi mở ca thứ hai và vẫn giao cho thu ngân 1, rồi lại assert họ chỉ thấy 1 ca — họ thấy 2 là đúng. Đã sửa test cho giao ca mới sang thu ngân 2.

### 2026-08-26, phần 4 — review Cash Drawer rồi sửa

Review nêu 3 lỗi thật, 2 chỗ nới lỏng, 4 đổi response, 1 điểm nhỏ. Chủ dự án chốt: **sửa những lỗi.**

138. **Chốt chống ghi đè của phiếu ca không còn tác dụng khi không bàn giao.** Tôi giữ đúng chốt `updatedAt` của bản cũ nhưng viết `data: dto.nextStaffId ? { currentStaffId } : {}`. **Đo bằng probe chạy thật trên Postgres**: `updateMany` với `data: {}` khớp 1 dòng nhưng **không** bump `@updatedAt` (`matched=1 updatedAtChanged=false`). Nên với `START`, hoặc `END` không bàn giao, chốt không bao giờ tiến — hai request giống hệt (bấm hai lần, client tự retry) đều lọt và ghi **2 phiếu ca trùng**, đúng thứ mà cả module này sinh ra để chặn.
    Bản cũ không dính vì phiếu ca là mảng nhúng: `$push` luôn làm `updatedAt` đổi. Tách sang bảng riêng là đúng cho Postgres nhưng lấy mất tác dụng phụ mà chốt đang dựa vào. Giờ ghi `currentStaffId` **không điều kiện** (giá trị không đổi trừ khi bàn giao), kèm comment giải thích vì sao `data` không được rỗng.
139. **Nhân viên không được phân chi nhánh nhìn thấy quầy của mọi chi nhánh.** `findRow`/`findAll` chỉ lọc chi nhánh khi `user.branchId` có giá trị; một STAFF được cấp `cash_drawers:read` mà chưa phân chi nhánh thì rơi vào "không lọc gì". Bản cũ ném 403 `"User has no branch assigned"`. Đáng nói: **sáng cùng ngày tôi đã xử đúng chỗ này ở `orders.branchScope`** rồi lại để hở ở đây — hai module viết cùng ngày, cùng một luật, lệch nhau.
    Giờ **mọi đường đều đi qua `resolveBranch`**, kể cả đường đọc: có chi nhánh → đúng chi nhánh đó; TENANT_OWNER/ADMIN → chi nhánh họ khai hoặc tất cả; còn lại không có chi nhánh → 403.
140. `resolveBranch` trả `null` cho "mọi chi nhánh" thay vì chuỗi rỗng — `''` vẫn là `string` và sớm muộn lọt vào một `where` như một branchId thật.
141. `shiftLogs` sắp theo `[{loggedAt: asc}, {id: asc}]`. `id` chỉ là tie-break cho **ổn định**, không phải khẳng định thứ tự chèn — hai phiếu cách nhau một micro giây trước đó trả về thứ tự tuỳ mỗi lần đọc, mà `shiftLogs.at(-1)` là nền của toàn bộ máy trạng thái START/END/finalize. Cái thật sự chặn trùng là mục 138.

**Không sửa** (review có nêu, không phải lỗi): `GET /current` lỏng hơn bản cũ (bản cũ chỉ trả ca mình **đang giữ**; giờ ai từng ghi phiếu ca đó cũng xem được — cùng dữ liệu họ đã đọc được qua `GET /:id`, nên không phải rò rỉ); `fromDate`/`toDate` dùng `@IsDateString()` nên nhận cả ISO datetime đầy đủ chứ không chỉ `YYYY-MM-DD`; và 4 điểm đổi response (`businessDate` giờ là ISO datetime — **chỗ frontend dễ vấp nhất**, `shiftLogCount`, limit 20→10, 404→409).

**Kiểm chứng**: `tsc` · `lint` · `build` · `check-permissions` · `migrate status` sạch · unit **95/95** · **e2e 35/35 trên Postgres thật**. Smoke thêm 2 kịch bản đúng vào hai lỗi: **hai phiếu START giống hệt gửi song song → 200 + 409, đúng 1 phiếu được ghi**; và nhân viên bị gỡ chi nhánh nhưng vẫn có `cash_drawers:read` → **403** cả khi liệt kê lẫn khi đọc theo id.

## Việc CHƯA làm — đừng quên

- **Refresh token / logout** — vẫn cố ý hoãn, chờ bạn wire Redis (đã có `REDIS_URL` trong `.env` nhưng chưa dùng ở đâu trong code). OTP cũng đang lưu in-memory vì cùng lý do — khi wire Redis thì làm cả 2 luôn thể.
- **22 module CRUD còn lại** (sinh tự động từ schema bằng `scripts/generate-modules.js` — script vẫn còn trong repo; chạy lại sẽ **ghi đè** mọi sửa tay trong các file sinh tự động, trừ các model trong `PORTED_MODELS`) — đã có JWT guard + tenant-scoping + `@Permissions()` (phần 4 và 5 ngày 17/8), nhưng **chưa có business logic thật** và chưa response envelope — service bên dưới vẫn là 1 lệnh Prisma mỗi method, và route vẫn là CRUD phẳng chứ chưa có các endpoint giàu hơn của bản cũ. Thứ tự đề xuất: cấu hình nhân sự (PayrollSetting/Paysheet/ShiftTemplate/Holiday) → Staff → Schedule/Attendance/LeaveRequest → Payroll → Product/Inventory/StockMovement → Order/Promotion/CashDrawer → Ticket/Stats/AI. Xem artifact "Feature Ledger" mục "Thứ tự build".
- **Response envelope `{success, message?, data?}`** — vẫn chưa làm ở bất kỳ module nào, kể cả các module đã port thật (auth/roles/users/audit-logs/plans/subscriptions/subscription-invoices/notifications/branches/warehouses/suppliers/brands/categories trả thẳng JSON của Nest/Prisma). **Global exception filter thì đã có rồi** (mục 42 ngày 20/8) — phần còn thiếu là interceptor bọc response, và nó đổi contract của mọi controller đã port nên phải làm một lượt. Càng để lâu càng nhiều chỗ phải sửa lại.
- **FCM push** — Socket.IO thật rồi (xem phần 2 ngày 17/8), nhưng push (app đóng/không mở) vẫn chưa — `UserFcmToken` đã thu thập được qua `POST /notifications/device-token` nhưng chưa có gì gửi tới token đó.
- **Notification/audit template mới chỉ có cho domain Subscription** — các domain khác (leave request, stock movement, ticket...) khi port thật phải tự thêm file `*.templates.ts`/`*.audit-template.ts` riêng theo đúng rule mới, không viết thẳng vào `NotificationService`/`AuditInterceptor`.
- **Bước tiếp theo**: nhóm 6 — Ticket/Stats/AI/system-notification/tenant/upload. Nhóm 5 đã xong hết. **Nhóm 1 (cấu hình nhân sự) và nhóm 3 (chấm công/nghỉ phép) để sau cùng** theo thứ tự chủ dự án chốt 25/8. Đã xong: org/reference data 19/8 (mục 31–39), catalogue 25/8 (mục 58–73), Staff + StockMovement 25/8 phần 2 (mục 74–89), Order + Promotion + Customer 26/8 (mục 108–123).
- **`CashDrawerSession` chưa đối chiếu với `CashFlow`** — ca quầy ghi số đếm được (đầu ca, từng phiếu ca, cuối ca) nhưng chưa ai so nó với các dòng `CashFlow` mà bán hàng sinh ra trong cùng ngày/chi nhánh. Đó là phần báo cáo lệch quỹ, chưa port; xem mục 119 về việc vì sao dòng tiền thối không gắn `orderId`.
- **Còn một `follow-up migration` chưa làm**: `CHECK (num_nonnulls(branch_id, warehouse_id) = 1)` cho `inventories` — xem `prisma/schema.prisma` dòng ~617. Cùng loại với mục 132, và hiện chỉ có tầng ứng dụng chặn.
- ~~e2e chưa chạy~~ — **đã trả xong 25/8 phần 4**: e2e 17/17 trên Postgres thật, kèm smoke suite phủ 4 module port hôm nay. Nợ này mở từ 20/8 — Docker Desktop không chạy trên máy lúc làm nên chỉ có `test/di-check.e2e-spec.ts` (không cần DB) được xác minh. Chạy `docker compose up -d && pnpm run test:e2e` trước khi commit đợt này.
- ~~Còn nợ từ đợt 19/8~~ — đã trả xong cả hai: `Product.categoryName` (mục 62) và hạn mức công nợ NCC (mục 84), đều ngày 25/8.
- **`WorkingSchedule` sẽ phải nới `StockMovementService.canActAt()`** — quyền tạm theo lịch làm việc (`managedScheduleAccess`) của bản cũ chưa có chỗ nào thay thế, xem mục 86.

## Trạng thái git (cập nhật 2026-08-26)

- `iKiot-BE`: remote `origin` = `https://github.com/iKiotMS/nestjs-ikiot.git`, nhánh `main`, **7 commit** — mới nhất `68cb643 add product, inventory and stock-movement`. Nghĩa là toàn bộ đợt 25/8 (product/inventory, staff/stock-movement, review, validator + smoke test) **đã được commit**.
- **Chưa commit: 49 mục** — toàn bộ ngày 26/8: order + promotion + customer (mục 108–123), review/sửa (124–131), cash drawer (132–137), review/sửa cash drawer (138–141). Gồm **2 migration mới**.
- `iKiotMS-BE`: remote `origin` = `https://github.com/iKiotMS/iKiotMS-BE.git`. Chỉ có `CLAUDE.md` chưa commit, **không có thay đổi code nào** — đúng quy ước một chiều.

Đừng tin đoạn này nếu nó lệch với `git log`/`git status` thật — cập nhật lại đoạn này (hoặc thêm mục ngày mới) mỗi khi commit/push để nó không lạc hậu.
