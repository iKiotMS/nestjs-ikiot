// Seeds the fixed PermissionCatalog every tenant-defined Role draws from. This taxonomy is
// carried over from iKiotMS-BE's src/config/permissions.json (the union of every
// resource+action pair actually enforced via authorize() across the old 6 static roles) —
// it is the app's contract, not tenant-editable data. Run with `prisma db seed`.
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const CATALOG: Record<string, { actions: string[]; label: string }> = {
  users: { actions: ['create', 'read', 'update', 'delete', 'assign_role', 'create_staff'], label: 'Tài khoản' },
  staff: { actions: ['create', 'read', 'update', 'delete', 'assign_role', 'suspend', 'inactive'], label: 'Nhân viên' },
  tenants: { actions: ['create', 'read', 'update', 'delete', 'suspend'], label: 'Doanh nghiệp' },
  products: { actions: ['create', 'read', 'update', 'delete'], label: 'Sản phẩm' },
  categories: { actions: ['create', 'read', 'update', 'delete'], label: 'Danh mục' },
  brands: { actions: ['create', 'read', 'update', 'delete'], label: 'Thương hiệu' },
  suppliers: { actions: ['create', 'read', 'update', 'delete', 'pay_debt'], label: 'Nhà cung cấp' },
  branches: { actions: ['create', 'read', 'update', 'delete', 'assign_manager'], label: 'Chi nhánh' },
  warehouses: { actions: ['create', 'read', 'update', 'delete', 'assign_manager'], label: 'Kho' },
  orders: { actions: ['create', 'read', 'update', 'view_all', 'pay_offline'], label: 'Đơn hàng' },
  inventory: { actions: ['read', 'update', 'view_all', 'manage'], label: 'Tồn kho' },
  subscriptions: { actions: ['read', 'update', 'manage'], label: 'Gói dịch vụ' },
  promotions: { actions: ['create', 'read', 'update', 'delete', 'calculate', 'apply'], label: 'Khuyến mãi' },
  notifications: { actions: ['create', 'read', 'update', 'delete'], label: 'Thông báo' },
  reports: { actions: ['read', 'export'], label: 'Báo cáo' },
  attendances: { actions: ['create', 'read', 'update', 'read_own'], label: 'Chấm công' },
  leaveRequests: {
    actions: ['create', 'read', 'update', 'delete', 'read_all', 'read_mine', 'readBR', 'readWH', 'approve', 'reject', 'cancel', 'create_emergency'],
    label: 'Đơn nghỉ phép',
  },
  cash_drawers: { actions: ['open', 'read', 'report', 'finalize', 'read_own'], label: 'Ca thu ngân' },
  paysheets: { actions: ['create', 'read', 'update', 'delete'], label: 'Bảng lương mẫu' },
  schedules: { actions: ['create', 'read', 'update', 'delete', 'read_all', 'read_own', 'readBR', 'readWH'], label: 'Lịch làm việc' },
  stock_movement: { actions: ['create', 'read', 'update', 'approve', 'receive', 'cancel'], label: 'Xuất/nhập kho' },
  payrollSettings: { actions: ['create', 'read', 'update'], label: 'Cấu hình lương' },
  payroll: { actions: ['create', 'read', 'update', 'delete'], label: 'Kỳ lương' },
  payslips: { actions: ['read_own'], label: 'Phiếu lương' },
  holidays: { actions: ['create', 'read', 'update', 'delete'], label: 'Ngày lễ' },
  profile: { actions: ['read'], label: 'Hồ sơ cá nhân' },
};

async function main() {
  const rows = Object.entries(CATALOG).flatMap(([resource, { actions, label }]) =>
    actions.map((action) => ({ resource, action, label })),
  );

  for (const row of rows) {
    await prisma.permissionCatalog.upsert({
      where: { resource_action: { resource: row.resource, action: row.action } },
      update: { label: row.label },
      create: row,
    });
  }

  console.log(`Seeded ${rows.length} permission catalog entries across ${Object.keys(CATALOG).length} resources.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
