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

## Việc CHƯA làm — đừng quên

- **Refresh token / logout** — vẫn cố ý hoãn, chờ bạn wire Redis (đã có `REDIS_URL` trong `.env` nhưng chưa dùng ở đâu trong code). OTP cũng đang lưu in-memory vì cùng lý do — khi wire Redis thì làm cả 2 luôn thể.
- **29 module CRUD còn lại** (sinh tự động từ schema, xem `scripts/generate-modules.js` — đã xoá sau khi chạy, xem lại trong git history nếu cần) — mới có JWT guard, chưa có `@Permissions()`, chưa tenant-scoping thật, chưa response envelope, chưa business logic thật. Thứ tự đề xuất: org/reference data (Branch/Warehouse/Brand/Category/Supplier) → cấu hình nhân sự (PayrollSetting/Paysheet/ShiftTemplate/Holiday) → Staff → Schedule/Attendance/LeaveRequest → Payroll → Product/Inventory/StockMovement → Order/Promotion/CashDrawer → Ticket/Stats/AI. Xem artifact "Feature Ledger" mục "Thứ tự build".
- **Response envelope `{success, message?, data?}`** + global exception filter — chưa làm ở bất kỳ module nào, kể cả các module đã port thật (auth/roles/users/audit-logs/plans/subscriptions/subscription-invoices/notifications trả thẳng JSON của Nest/Prisma). Cần quyết định có làm không và làm lúc nào — càng để lâu càng nhiều chỗ phải sửa lại.
- **FCM push** — Socket.IO thật rồi (xem phần 2 ngày 17/8), nhưng push (app đóng/không mở) vẫn chưa — `UserFcmToken` đã thu thập được qua `POST /notifications/device-token` nhưng chưa có gì gửi tới token đó.
- **Notification/audit template mới chỉ có cho domain Subscription** — các domain khác (leave request, stock movement, ticket...) khi port thật phải tự thêm file `*.templates.ts`/`*.audit-template.ts` riêng theo đúng rule mới, không viết thẳng vào `NotificationService`/`AuditInterceptor`.
- **Bước tiếp theo đang thảo luận dở**: port module `Branch`/`Warehouse` thật (users module đang tham chiếu `branchId`/`warehouseId` nhưng 2 module đó vẫn CRUD sinh tự động).

## Trạng thái git (cập nhật lúc viết mục 2026-08-17 phần 2 ở trên)

- `iKiot-BE`: remote `origin` = `https://github.com/iKiotMS/nestjs-ikiot.git`, nhánh `main`, **2 commit** ("first commit", "handoff work" — phần RBAC/auth/roles/users ngày 14/8 đã được commit). **Toàn bộ phần ngày 17/8 (Swagger, OTP/Firebase, Audit, Subscription, Socket.IO, Notification thật) vẫn chưa commit.**
- `iKiotMS-BE`: remote `origin` = `https://github.com/iKiotMS/iKiotMS-BE.git`. Chỉ có `CLAUDE.md` chưa commit, không có thay đổi code nào khác.

Đừng tin đoạn này nếu nó lệch với `git log`/`git status` thật — cập nhật lại đoạn này (hoặc thêm mục ngày mới) mỗi khi commit/push để nó không lạc hậu.
