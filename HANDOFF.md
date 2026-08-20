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

**Đã cân nhắc và cố ý KHÔNG làm** (nêu ra để lần sau khỏi tưởng là bỏ sót):
- `CreateOrderDto` vẫn nhận `status`/`grandTotal`/`customerPay`/`change`/`discountValue` từ client. Khoá lại bây giờ là làm hỏng endpoint: module orders chưa port, **không có gì tính được các số đó** để thay thế. Phải làm cùng lúc với port thật module orders. Các DTO sinh tự động khác nhiều khả năng cùng vấn đề.
- Đổi `tenantId?: string` thành kiểu tường minh (`TenantScope = {all: true} | {tenantId: string}`) để compiler bắt lỗi quên check — đúng nhưng đụng vào 22 module sinh tự động **và** template generator; churn lớn trên code sẽ được sinh lại. Để lại khi port thật từng module.

**Kiểm chứng**: `tsc --noEmit` sạch · `pnpm run lint` sạch · `pnpm run build` sạch · `node scripts/check-permissions.js` OK (3 cặp `subscriptions:*` mới đều có sẵn trong catalog, không phải sửa seed) · unit **8/8** (thêm `subscription-status.spec.ts`) · thêm `test/di-check.e2e-spec.ts` **2/2** — spec này chỉ `.compile()` DI graph, **không cần database**, và kiểm rằng `@AuditTemplate()` thật sự được discovery tìm thấy (nếu không, audit chỉ âm thầm rơi về mô tả generic chứ không lỗi). **Chưa chạy được e2e đầy đủ**: Docker Desktop không chạy trên máy lúc làm, nên các e2e cần Postgres chưa xác minh — chạy lại `docker compose up -d && pnpm run test:e2e` trước khi commit.

## Việc CHƯA làm — đừng quên

- **Refresh token / logout** — vẫn cố ý hoãn, chờ bạn wire Redis (đã có `REDIS_URL` trong `.env` nhưng chưa dùng ở đâu trong code). OTP cũng đang lưu in-memory vì cùng lý do — khi wire Redis thì làm cả 2 luôn thể.
- **22 module CRUD còn lại** (sinh tự động từ schema bằng `scripts/generate-modules.js` — script vẫn còn trong repo; chạy lại sẽ **ghi đè** mọi sửa tay trong các file sinh tự động, trừ các model trong `PORTED_MODELS`) — đã có JWT guard + tenant-scoping + `@Permissions()` (phần 4 và 5 ngày 17/8), nhưng **chưa có business logic thật** và chưa response envelope — service bên dưới vẫn là 1 lệnh Prisma mỗi method, và route vẫn là CRUD phẳng chứ chưa có các endpoint giàu hơn của bản cũ. Thứ tự đề xuất: cấu hình nhân sự (PayrollSetting/Paysheet/ShiftTemplate/Holiday) → Staff → Schedule/Attendance/LeaveRequest → Payroll → Product/Inventory/StockMovement → Order/Promotion/CashDrawer → Ticket/Stats/AI. Xem artifact "Feature Ledger" mục "Thứ tự build".
- **Response envelope `{success, message?, data?}`** — vẫn chưa làm ở bất kỳ module nào, kể cả các module đã port thật (auth/roles/users/audit-logs/plans/subscriptions/subscription-invoices/notifications/branches/warehouses/suppliers/brands/categories trả thẳng JSON của Nest/Prisma). **Global exception filter thì đã có rồi** (mục 42 ngày 20/8) — phần còn thiếu là interceptor bọc response, và nó đổi contract của mọi controller đã port nên phải làm một lượt. Càng để lâu càng nhiều chỗ phải sửa lại.
- **FCM push** — Socket.IO thật rồi (xem phần 2 ngày 17/8), nhưng push (app đóng/không mở) vẫn chưa — `UserFcmToken` đã thu thập được qua `POST /notifications/device-token` nhưng chưa có gì gửi tới token đó.
- **Notification/audit template mới chỉ có cho domain Subscription** — các domain khác (leave request, stock movement, ticket...) khi port thật phải tự thêm file `*.templates.ts`/`*.audit-template.ts` riêng theo đúng rule mới, không viết thẳng vào `NotificationService`/`AuditInterceptor`.
- **Bước tiếp theo**: nhóm cấu hình nhân sự (PayrollSetting/Paysheet/ShiftTemplate/Holiday), rồi Staff. Nhóm org/reference data đã port xong ngày 19/8 (mục 31–39).
- **e2e chưa chạy lại sau đợt review 20/8** — Docker Desktop không chạy trên máy lúc làm nên chỉ có `test/di-check.e2e-spec.ts` (không cần DB) được xác minh. Chạy `docker compose up -d && pnpm run test:e2e` trước khi commit đợt này.
- **Còn nợ từ đợt 19/8**: hạn mức công nợ NCC (`creditLimit`) hiện chỉ lưu, chưa ai kiểm — logic kiểm nằm ở stock-movement lúc nhận hàng, chưa port. Tương tự `Product.categoryName` (bản copy denormalized) vẫn không được cập nhật khi đổi tên danh mục, đúng như bản cũ — xử lý khi port module products.

## Trạng thái git (cập nhật 2026-08-20)

- `iKiot-BE`: remote `origin` = `https://github.com/iKiotMS/nestjs-ikiot.git`, nhánh `main`, **4 commit** ("first commit", "handoff work", "add audit/noti/subcription/role", "update decode token and clean dead code"). **Chưa commit: ~100 file** — phần 3/4/5 của ngày 17/8, toàn bộ đợt 19/8 (5 module org/reference data + migration), và toàn bộ đợt review 20/8 ở trên.
- `iKiotMS-BE`: remote `origin` = `https://github.com/iKiotMS/iKiotMS-BE.git`. Chỉ có `CLAUDE.md` chưa commit, không có thay đổi code nào khác.

Đừng tin đoạn này nếu nó lệch với `git log`/`git status` thật — cập nhật lại đoạn này (hoặc thêm mục ngày mới) mỗi khi commit/push để nó không lạc hậu.
