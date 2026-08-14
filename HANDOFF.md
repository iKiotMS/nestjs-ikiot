# Session Handoff

Đọc file này trước khi làm tiếp — dành cho một phiên Claude Code mới (hoặc bạn) tiếp tục công việc migrate `iKiotMS-BE` (Node/Express/Mongoose) sang `iKiot-BE` (NestJS/Prisma/PostgreSQL) từ một máy khác.

## Bối cảnh

`Code-trom/` là workspace chứa 2 project độc lập:
- **`iKiotMS-BE/`** — backend cũ (Express + MongoDB), nguồn sự thật cho toàn bộ business logic. Không sửa gì ở đây trừ `CLAUDE.md`.
- **`iKiot-BE/`** — backend mới (NestJS + Prisma + PostgreSQL), đang được build dần từ đây.

Đọc `iKiot-BE/CLAUDE.md` và `iKiotMS-BE/CLAUDE.md` trước — 2 file đó là tài liệu kiến trúc thường trực, đã cập nhật đầy đủ theo mọi quyết định trong file này. File `HANDOFF.md` này chỉ là bổ sung góc nhìn "đang làm dở gì, tiếp theo làm gì" mà CLAUDE.md không có chỗ cho.

## 2 tài liệu tham chiếu đã xuất bản (Claude Artifacts)

Nếu đăng nhập cùng tài khoản Claude trên máy khác, 2 link này vẫn xem được (browse thêm tại claude.ai/code/artifacts nếu link đổi):

- **iKiotMS Postgres Migration** — https://claude.ai/code/artifact/bc9977f1-823d-41c3-a713-4ded56332db3 — bản đồ chuyển đổi từng field của 34 model Mongoose sang bảng Postgres/Prisma.
- **iKiotMS Feature Ledger** — https://claude.ai/code/artifact/53e9a4c4-4409-487a-9fe6-b3f5901d9114 — kiểm kê đầy đủ ~150 endpoint + business rule của 28 module trong `iKiotMS-BE`, cộng **56 vấn đề/bug/điểm mơ hồ** cần chốt trước khi port từng module. **Đọc mục "Vấn đề cần chốt" trong đó trước khi port bất kỳ module nghiệp vụ nào** — đặc biệt payroll (#27: bonus engine chưa từng chạy, phải xây mới) và leave-request (#25: mâu thuẫn quyền warehouse manager).

## Đã build xong (session này, 2026-08-14)

1. **`prisma/schema.prisma`** — schema Postgres đầy đủ cho 33 entity + child/join table, convert từ Mongoose (xem comment đầu file schema).
2. **RBAC tuỳ biến theo tenant** — thay hệ 6-role cố định cũ bằng `User.systemRole` (`ADMIN | TENANT_OWNER | CUSTOMER | STAFF`) + `Role`/`RolePermission`/`PermissionCatalog`. Chi tiết đầy đủ, không lặp lại ở đây: mục **"Authorization"** trong `iKiot-BE/CLAUDE.md`.
3. **3 module hoàn chỉnh, có guard thật**: `auth` (register/login/me/đổi mật khẩu), `roles` (CRUD role + gán quyền, owner/admin-only), `users` (CRUD nhân viên trong tenant).
4. **Guard toàn cục**: `JwtAuthGuard` + `PermissionsGuard` gắn qua `APP_GUARD` — mọi route ở 33 module CRUD sinh sẵn trước đó giờ **đã yêu cầu JWT hợp lệ**, dù chưa có `@Permissions()` cụ thể (permission thật sẽ thêm dần khi port từng module).
5. **Bắt và sửa 1 lỗ hổng có sẵn từ trước**: `main.ts` chưa từng bật `ValidationPipe` toàn cục — mọi DTO validate trước đó chỉ decorative. Đã bật.

`pnpm run build` và `npx tsc --noEmit` đều pass sạch tại thời điểm viết file này.

## Việc CHƯA làm — đừng quên

- **Refresh token / logout, Firebase login, OTP SMS đăng ký & quên mật khẩu** — cố ý hoãn (refresh token sẽ lưu Redis, do bạn wire sau; 2 cái kia cần service ngoài chưa cấu hình trong `iKiot-BE`). `/auth/login`+`/auth/register` hiện chỉ chạy password auth thuần.
- **30 module CRUD còn lại** (được sinh tự động từ schema, xem `scripts/generate-modules.js`) — mới chỉ có JWT guard, chưa có `@Permissions()`, chưa có tenant-scoping enforcement thật, chưa có response envelope `{success, message?, data?}`, chưa có business logic thật (chỉ CRUD thẳng qua Prisma). Xem thứ tự build đề xuất trong artifact "Feature Ledger" ở trên (mục "Thứ tự build").
- **Chưa chạy được `prisma migrate dev` / `prisma db seed`** — không có Postgres thật trong môi trường build lúc đó. `.env` hiện có `DATABASE_URL` placeholder + `JWT_SECRET` dev-only. **Việc đầu tiên cần làm ở máy mới**: trỏ `DATABASE_URL` vào Postgres thật, đổi `JWT_SECRET`, rồi:
  ```bash
  pnpm install
  npx prisma migrate dev --name init
  npx prisma db seed
  pnpm run start:dev
  ```
- Bước tiếp theo đang thảo luận dở (chưa chốt): port module `Branch`/`Warehouse` thật — vì `users` module đang tham chiếu `branchId`/`warehouseId` nhưng 2 module đó vẫn là CRUD sinh tự động, chưa có business rule thật (quota, gán manager...).

## Trạng thái git lúc viết file này

- `iKiot-BE`: remote `origin` = `https://github.com/iKiotMS/nestjs-ikiot.git`, nhánh `main`, chỉ có 1 commit gốc ("first commit"). **Toàn bộ việc của session này (36 file) đang ở trạng thái staged, chưa commit, chưa push.**
- `iKiotMS-BE`: remote `origin` = `https://github.com/iKiotMS/iKiotMS-BE.git`. Chỉ có `CLAUDE.md` (thêm ở đầu session, chưa commit) — không có thay đổi code nào khác ở repo này.

Nếu bạn đọc file này mà git đã sạch (không còn gì staged) và có nhiều hơn 1 commit — nghĩa là phần "đã commit/push" bên dưới đã xảy ra, phần trạng thái này có thể lỗi thời, cứ tin vào `git log` thật hơn là đoạn text này.
