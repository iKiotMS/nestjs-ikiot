import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Throwaway smoke run over everything ported on 2026-08-25 — products, inventory, staff
 * and stock movements — against a real Postgres. Creates one tenant, exercises the routes,
 * and deletes everything it made.
 */
jest.setTimeout(120_000);

const PHONE_OWNER = '0987650001';
const PHONE_STAFF = '0987650002';
const TENANT_NAME = 'SmokeTest Shop 25-08';

describe('smoke: products / inventory / staff / stock movements', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let http: () => request.Agent;

  let ownerToken = '';
  let tenantId = '';
  let branchId = '';
  let warehouseId = '';
  let productId = '';
  let itemAId = '';
  let itemBId = '';
  let supplierId = '';
  let roleId = '';
  let staffId = '';
  let orderId = '';
  let promotionId = '';
  let sessionId = '';
  let secondStaffId = '';

  const auth = (token = ownerToken) => ({ Authorization: `Bearer ${token}` });
  const results: string[] = [];
  const note = (line: string) => results.push(line);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer());

    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();

    console.log('\n===== SMOKE RESULTS =====\n' + results.join('\n'));
  });

  async function cleanup() {
    const tenant = await prisma.tenant.findFirst({
      where: { name: TENANT_NAME },
      select: { id: true },
    });
    if (!tenant) return;
    const t = tenant.id;
    await prisma.cashDrawerShiftLog.deleteMany({
      where: { session: { tenantId: t } },
    });
    await prisma.cashDrawerSession.deleteMany({ where: { tenantId: t } });
    await prisma.promotionLog.deleteMany({ where: { tenantId: t } });
    await prisma.orderAppliedPromotion.deleteMany({
      where: { order: { tenantId: t } },
    });
    await prisma.orderItem.deleteMany({ where: { order: { tenantId: t } } });
    await prisma.cashFlow.deleteMany({ where: { tenantId: t } });
    await prisma.order.deleteMany({ where: { tenantId: t } });
    await prisma.customer.deleteMany({ where: { tenantId: t } });
    await prisma.promotionBranch.deleteMany({
      where: { promotion: { tenantId: t } },
    });
    await prisma.promotionCategory.deleteMany({
      where: { promotion: { tenantId: t } },
    });
    await prisma.promotionProductItem.deleteMany({
      where: { promotion: { tenantId: t } },
    });
    await prisma.promotion.deleteMany({ where: { tenantId: t } });
    await prisma.stockMovementRequestItem.deleteMany({
      where: { request: { tenantId: t } },
    });
    await prisma.stockMovementRequest.deleteMany({ where: { tenantId: t } });
    await prisma.inventory.deleteMany({ where: { tenantId: t } });
    await prisma.productItemSupplier.deleteMany({
      where: { productItem: { tenantId: t } },
    });
    await prisma.productItemImage.deleteMany({
      where: { productItem: { tenantId: t } },
    });
    await prisma.productItemDetail.deleteMany({
      where: { productItem: { tenantId: t } },
    });
    await prisma.productItem.deleteMany({ where: { tenantId: t } });
    await prisma.productImage.deleteMany({
      where: { product: { tenantId: t } },
    });
    await prisma.product.deleteMany({ where: { tenantId: t } });
    await prisma.supplier.deleteMany({ where: { tenantId: t } });
    await prisma.notification.deleteMany({ where: { tenantId: t } });
    await prisma.auditLog.deleteMany({ where: { tenantId: t } });
    await prisma.subscriptionHistoryLog.deleteMany({
      where: { subscription: { tenantId: t } },
    });
    await prisma.subscriptionInvoice.deleteMany({ where: { tenantId: t } });
    await prisma.subscription.deleteMany({ where: { tenantId: t } });
    await prisma.branch.updateMany({
      where: { tenantId: t },
      data: { managerId: null },
    });
    await prisma.warehouse.updateMany({
      where: { tenantId: t },
      data: { managerId: null },
    });
    await prisma.rolePermission.deleteMany({
      where: { role: { tenantId: t } },
    });
    await prisma.userFcmToken.deleteMany({ where: { user: { tenantId: t } } });
    await prisma.user.updateMany({
      where: { tenantId: t },
      data: { roleId: null, branchId: null, warehouseId: null },
    });
    await prisma.role.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.branch.deleteMany({ where: { tenantId: t } });
    await prisma.warehouse.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.deleteMany({ where: { id: t } });
  }

  it('sets up a tenant on a trial with a branch, a warehouse and a supplier', async () => {
    const registered = await http()
      .post('/auth/register')
      .send({
        tenantName: TENANT_NAME,
        phoneNumber: PHONE_OWNER,
        password: 'password123',
        otpCode: 'DEV_BYPASS',
      })
      .expect(201);
    ownerToken = registered.body.accessToken;
    tenantId = registered.body.user.tenantId;
    note(`register: OK tenant=${tenantId.slice(0, 8)}`);

    await http()
      .post('/subscription/free-trial')
      .set(auth())
      .send()
      .expect(201);
    const status = await http()
      .get('/subscription/status')
      .set(auth())
      .expect(200);
    note(
      `subscription: ${status.body.status} daysLeft=${status.body.daysLeft}`,
    );

    const branch = await http()
      .post('/branches')
      .set(auth())
      .send({ name: 'CN Q1', phoneNumber: ['0987650010'] })
      .expect(201);
    branchId = branch.body.id;

    const warehouse = await http()
      .post('/warehouses')
      .set(auth())
      .send({ name: 'Kho Trung Tam', phoneNumber: ['0987650011'] })
      .expect(201);
    warehouseId = warehouse.body.id;
    note('branch + warehouse: OK');

    const supplier = await http()
      .post('/suppliers')
      .set(auth())
      .send({ supplierName: 'NCC Alpha', creditLimit: 10_000_000 })
      .expect(201);
    supplierId = supplier.body.id;
    note(`supplier: OK creditLimit=${supplier.body.creditLimit}`);
  });

  it('creates a product with variants and opening stock, in one transaction', async () => {
    const created = await http()
      .post('/products')
      .set(auth())
      .send({
        name: 'Áo thun',
        items: [
          {
            productName: 'Áo thun đỏ',
            productCode: 'AT-RED',
            sku: 'SKU-RED',
            retailPrice: 200000,
            costPrice: 120000,
            productDetails: [{ name: 'Màu', value: 'Đỏ' }],
            initialStock: [
              { locationId: warehouseId, locationType: 'warehouse', stock: 50 },
              { locationId: branchId, locationType: 'branch', stock: 8 },
            ],
          },
          {
            productName: 'Áo thun xanh',
            productCode: 'AT-BLUE',
            sku: 'SKU-BLUE',
            retailPrice: 210000,
            costPrice: 130000,
          },
        ],
      })
      .expect(201);

    productId = created.body.id;
    itemAId = created.body.items.find((i: any) => i.sku === 'SKU-RED').id;
    itemBId = created.body.items.find((i: any) => i.sku === 'SKU-BLUE').id;

    expect(created.body.totalStock).toBe(58);
    expect(typeof created.body.items[0].retailPrice).toBe('number');
    note(
      `POST /products: OK totalStock=${created.body.totalStock} items=${created.body.items.length} price is number=${typeof created.body.items[0].retailPrice === 'number'}`,
    );

    await http()
      .post('/products')
      .set(auth())
      .send({
        name: 'Trùng SKU',
        items: [
          {
            productName: 'x',
            productCode: 'x',
            sku: 'SKU-RED',
            retailPrice: 1,
            costPrice: 1,
          },
        ],
      })
      .expect(409);
    note('POST /products duplicate SKU: 409 OK');

    const rolled = await prisma.product.count({
      where: { tenantId, name: 'Trùng SKU' },
    });
    expect(rolled).toBe(0);
    note('duplicate SKU left no half-created product: OK');
  });

  it('lists, searches and reads back products', async () => {
    const list = await http().get('/products').set(auth()).expect(200);
    expect(list.body.data[0].totalStock).toBe(58);
    note(
      `GET /products: OK total=${list.body.pagination.total} totalStock=${list.body.data[0].totalStock}`,
    );

    const scoped = await http()
      .get(`/products?locationId=${branchId}&locationType=branch`)
      .set(auth())
      .expect(200);
    expect(scoped.body.data[0].totalStock).toBe(8);
    note('GET /products?locationId=branch: totalStock scoped to 8 OK');

    const search = await http()
      .get('/products/search?q=SKU-BL')
      .set(auth())
      .expect(200);
    expect(search.body.data).toHaveLength(1);
    note(`GET /products/search?q=SKU-BL: ${search.body.data.length} hit OK`);

    const items = await http().get('/products/items').set(auth()).expect(200);
    expect(items.body).toHaveLength(2);
    note(`GET /products/items: ${items.body.length} variants OK`);

    const detail = await http()
      .get(`/products/${productId}`)
      .set(auth())
      .expect(200);
    const red = detail.body.items.find((i: any) => i.sku === 'SKU-RED');
    expect(red.stockDetails).toHaveLength(2);
    note(`GET /products/:id: stockDetails=${red.stockDetails.length} OK`);

    await http()
      .get('/products?locationId=' + branchId)
      .set(auth())
      .expect(400);
    note('locationId without locationType: 400 OK');
  });

  it('runs the inventory routes, including the low-stock filter', async () => {
    const all = await http().get('/inventory').set(auth()).expect(200);
    expect(all.body.pagination.total).toBe(2);
    expect(all.body.data[0].location).toBeTruthy();
    note(
      `GET /inventory: ${all.body.pagination.total} rows, location object OK`,
    );

    const branchRow = all.body.data.find(
      (r: any) => r.location.locationType === 'branch',
    );
    await http()
      .patch(`/inventory/${branchRow.id}/min-stock`)
      .set(auth())
      .send({ minStock: 10 })
      .expect(200);

    const low = await http()
      .get('/inventory?isLowStock=true')
      .set(auth())
      .expect(200);
    expect(low.body.pagination.total).toBe(1);
    note(
      `GET /inventory?isLowStock=true: ${low.body.pagination.total} row (stock 8 <= min 10) OK — Prisma field reference works`,
    );

    const added = await http()
      .post('/inventory')
      .set(auth())
      .send({
        locationId: branchId,
        locationType: 'branch',
        productItemId: itemBId,
      })
      .expect(201);
    await http()
      .post('/inventory')
      .set(auth())
      .send({
        locationId: branchId,
        locationType: 'branch',
        productItemId: itemBId,
      })
      .expect(409);
    note('POST /inventory + duplicate: 201 then 409 OK');

    const removed = await http()
      .delete(`/inventory/${added.body.id}`)
      .set(auth())
      .expect(200);
    expect(removed.body).toEqual({ success: true });
    note('DELETE /inventory/:id → {success:true} OK');

    await http().delete(`/inventory/${branchRow.id}`).set(auth()).expect(400);
    note('DELETE /inventory/:id with stock > 0: 400 OK');
  });

  it('manages a staff account end to end', async () => {
    const role = await http()
      .post('/roles')
      .set(auth())
      .send({
        name: 'Thu ngân',
        permissions: [
          { resource: 'stock_movement', action: 'create' },
          { resource: 'stock_movement', action: 'read' },
          { resource: 'stock_movement', action: 'update' },
          { resource: 'stock_movement', action: 'approve' },
          { resource: 'stock_movement', action: 'receive' },
        ],
      })
      .expect(201);
    roleId = role.body.id;

    await http()
      .post('/users')
      .set(auth())
      .send({
        phoneNumber: '0651234567',
        password: 'password123',
        roleId,
        branchId,
      })
      .expect(400);
    note('POST /users with VoIP prefix 065: 400 OK (phone validator wired)');

    const staff = await http()
      .post('/users')
      .set(auth())
      .send({
        phoneNumber: PHONE_STAFF,
        password: 'password123',
        roleId,
        branchId,
      })
      .expect(201);
    staffId = staff.body.id;

    const list = await http().get('/users').set(auth()).expect(200);
    expect(list.body.pagination.total).toBe(1);
    note(
      `GET /users: paginated, total=${list.body.pagination.total} (owner excluded) OK`,
    );

    const searched = await http()
      .get('/users?search=098765')
      .set(auth())
      .expect(200);
    expect(searched.body.pagination.total).toBe(1);
    note('GET /users?search: OK');

    await http()
      .patch(`/users/${staffId}`)
      .set(auth())
      .send({
        profile: {
          firstName: 'Trần',
          lastName: 'An',
          identificationId: '079195001234',
          gender: 'MALE',
        },
      })
      .expect(400);
    note('PATCH /users/:id CCCD vs gender mismatch: 400 OK');

    const updated = await http()
      .patch(`/users/${staffId}`)
      .set(auth())
      .send({
        profile: {
          firstName: 'Trần',
          lastName: 'An',
          identificationId: '079195001234',
          gender: 'FEMALE',
          dob: '1995-03-04',
        },
        warehouseId,
      })
      .expect(200);
    expect(updated.body.branchId).toBeNull();
    expect(updated.body.warehouseId).toBe(warehouseId);
    expect(updated.body.profileIdentificationId).toBe('079195001234');
    note('PATCH /users/:id profile + posting swap (branch cleared): OK');

    const balance = await http()
      .patch(`/users/${staffId}/leave-balance`)
      .set(auth())
      .send({ annualLeaveDays: 15 })
      .expect(200);
    expect(balance.body.message).toBeTruthy();
    expect(balance.body.data).toBeTruthy();
    expect(balance.body.leaveBalance.remainingDays).toBe(15);
    note('PATCH leave-balance → {message,data,leaveBalance} OK');

    await http()
      .patch(`/users/${staffId}/account/deactivate`)
      .set(auth())
      .expect(200);
    const afterDeactivate = await prisma.user.findUnique({
      where: { id: staffId },
      select: { status: true, password: true },
    });
    expect(afterDeactivate?.status).toBe('INACTIVE');
    expect(afterDeactivate?.password).toBeNull();
    note('deactivate: status INACTIVE + password cleared OK');

    await http()
      .post(`/users/${staffId}/account`)
      .set(auth())
      .send({ newPassword: 'newpass123', reEnterPassword: 'nope' })
      .expect(400);
    await http()
      .post(`/users/${staffId}/account`)
      .set(auth())
      .send({ newPassword: 'newpass123', reEnterPassword: 'newpass123' })
      .expect(201);
    note('re-activate account (mismatch 400, then 201) OK');

    // Put them back on the branch for the stock-movement scenario below.
    await http()
      .patch(`/users/${staffId}`)
      .set(auth())
      .send({ branchId })
      .expect(200);
  });

  it('runs an EXPORT movement from warehouse to branch', async () => {
    const created = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'EXPORT',
        fromLocation: { locationId: warehouseId, locationType: 'warehouse' },
        toLocation: { locationId: branchId, locationType: 'branch' },
        details: [{ productItemId: itemAId, quantity: 20 }],
      })
      .expect(201);
    const id = created.body.id;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.totalPrice).toBe(20 * 120000);
    note(
      `POST /stock-movements EXPORT: DRAFT, totalPrice=${created.body.totalPrice} (cost price defaulted) OK`,
    );

    await http().patch(`/stock-movements/${id}/ship`).set(auth()).expect(409);
    note('ship from DRAFT: 409 OK (state machine enforced)');

    await http().patch(`/stock-movements/${id}/open`).set(auth()).expect(200);
    await http().patch(`/stock-movements/${id}/close`).set(auth()).expect(200);
    await http().patch(`/stock-movements/${id}/ship`).set(auth()).expect(200);

    const afterShip = await prisma.inventory.findFirst({
      where: { tenantId, warehouseId, productItemId: itemAId },
      select: { stock: true },
    });
    expect(afterShip?.stock).toBe(30);
    note(`ship: warehouse 50 → ${afterShip?.stock} OK`);

    // Short delivery: 18 of 20 arrive.
    await http()
      .patch(`/stock-movements/${id}/receive`)
      .set(auth())
      .send({ details: [{ productItemId: itemAId, receivedQuantity: 18 }] })
      .expect(200);

    const atBranch = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });
    expect(atBranch?.stock).toBe(26);
    note(`receive 18 of 20: branch 8 → ${atBranch?.stock} OK (short delivery)`);
  });

  it('returns stock when an in-transit movement is cancelled', async () => {
    const created = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'EXPORT',
        fromLocation: { locationId: warehouseId, locationType: 'warehouse' },
        toLocation: { locationId: branchId, locationType: 'branch' },
        details: [{ productItemId: itemAId, quantity: 5 }],
      })
      .expect(201);
    const id = created.body.id;

    await http().patch(`/stock-movements/${id}/open`).set(auth()).expect(200);
    await http().patch(`/stock-movements/${id}/close`).set(auth()).expect(200);
    await http().patch(`/stock-movements/${id}/ship`).set(auth()).expect(200);
    await http().patch(`/stock-movements/${id}/cancel`).set(auth()).expect(200);

    const back = await prisma.inventory.findFirst({
      where: { tenantId, warehouseId, productItemId: itemAId },
      select: { stock: true },
    });
    expect(back?.stock).toBe(30);
    note(`cancel while IN_TRANSIT: warehouse back to ${back?.stock} OK`);
  });

  it('refuses to ship more than the source holds', async () => {
    const created = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'EXPORT',
        fromLocation: { locationId: warehouseId, locationType: 'warehouse' },
        toLocation: { locationId: branchId, locationType: 'branch' },
        details: [{ productItemId: itemAId, quantity: 9999 }],
      })
      .expect(400);
    expect(created.body.message).toContain('vượt quá tồn kho');
    note('create EXPORT beyond stock: 400 OK');
  });

  it('runs an IMPORT and enforces the supplier credit limit', async () => {
    const overLimit = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'IMPORT',
        fromSupplierId: supplierId,
        toLocation: { locationId: warehouseId, locationType: 'warehouse' },
        details: [
          { productItemId: itemAId, quantity: 100, importPrice: 150000 },
        ],
      })
      .expect(400);
    expect(overLimit.body.message).toContain('hạn mức công nợ');
    note('IMPORT over credit limit (15m > 10m): 400 OK');

    await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'IMPORT',
        fromSupplierId: supplierId,
        toLocation: { locationId: warehouseId, locationType: 'warehouse' },
        details: [{ productItemId: itemAId, quantity: 1, importPrice: 900000 }],
      })
      .expect(400);
    note('IMPORT with importPrice > retailPrice: 400 OK');

    const created = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'IMPORT',
        fromSupplierId: supplierId,
        toLocation: { locationId: warehouseId, locationType: 'warehouse' },
        details: [
          { productItemId: itemBId, quantity: 60, importPrice: 130000 },
        ],
      })
      .expect(201);
    expect(created.body.status).toBe('PENDING');

    await http()
      .patch(`/stock-movements/${created.body.id}/receive`)
      .set(auth())
      .send({ details: [{ productItemId: itemBId, receivedQuantity: 60 }] })
      .expect(200);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { outstandingDebt: true },
    });
    expect(Number(supplier?.outstandingDebt)).toBe(7_800_000);
    note(
      `IMPORT received: supplier debt = ${Number(supplier?.outstandingDebt)} (60 × 130k) OK`,
    );

    const stocked = await prisma.inventory.findFirst({
      where: { tenantId, warehouseId, productItemId: itemBId },
      select: { stock: true },
    });
    expect(stocked?.stock).toBe(60);
    note(
      `IMPORT created the inventory line that did not exist: stock=${stocked?.stock} OK (adjustStock upsert)`,
    );

    const linked = await prisma.productItemSupplier.count({
      where: { productItemId: itemBId, supplierId },
    });
    expect(linked).toBe(1);
    note('IMPORT linked the supplier to the received variant OK');

    // Nothing is sent here, and that is correct: the only recipient would be the tenant
    // owner, who is the person who just received the goods. iKiotMS-BE filtered the actor
    // out the same way. The warning firing for real is covered by the next test.
    const selfWarned = await prisma.notification.count({
      where: { tenantId, title: { contains: 'hạn mức' } },
    });
    expect(selfWarned).toBe(0);
    note(
      'credit warning suppressed when the owner receives the goods themselves: OK (actor excluded, same as old)',
    );
  });

  it('warns the owner when somebody else pushes the debt past 75%', async () => {
    const supplierB = await http()
      .post('/suppliers')
      .set(auth())
      .send({ supplierName: 'NCC Beta', creditLimit: 1_000_000 })
      .expect(201);

    // Move the staff member to the warehouse so they may receive there.
    await http()
      .patch(`/users/${staffId}`)
      .set(auth())
      .send({ warehouseId })
      .expect(200);

    const created = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'IMPORT',
        fromSupplierId: supplierB.body.id,
        toLocation: { locationId: warehouseId, locationType: 'warehouse' },
        details: [{ productItemId: itemBId, quantity: 8, importPrice: 100000 }],
      })
      .expect(201);

    const login = await http()
      .post('/auth/login')
      .send({ phoneNumber: PHONE_STAFF, password: 'newpass123' })
      .expect(201);

    await http()
      .patch(`/stock-movements/${created.body.id}/receive`)
      .set(auth(login.body.accessToken))
      .send({ details: [{ productItemId: itemBId, receivedQuantity: 8 }] })
      .expect(200);

    const warned = await prisma.notification.count({
      where: { tenantId, title: { contains: 'hạn mức' } },
    });
    expect(warned).toBe(1);
    note(
      `credit warning: staff receipt pushes NCC Beta to 80% of limit → ${warned} notification to the owner OK`,
    );

    // Edge-triggered: a second receipt above the line must stay quiet.
    const again = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'IMPORT',
        fromSupplierId: supplierB.body.id,
        toLocation: { locationId: warehouseId, locationType: 'warehouse' },
        details: [{ productItemId: itemBId, quantity: 1, importPrice: 100000 }],
      })
      .expect(201);
    await http()
      .patch(`/stock-movements/${again.body.id}/receive`)
      .set(auth(login.body.accessToken))
      .send({ details: [{ productItemId: itemBId, receivedQuantity: 1 }] })
      .expect(200);

    const stillOne = await prisma.notification.count({
      where: { tenantId, title: { contains: 'hạn mức' } },
    });
    expect(stillOne).toBe(1);
    note(
      'second receipt above the line: still 1 notification OK (edge-triggered, no spam)',
    );

    await http()
      .patch(`/users/${staffId}`)
      .set(auth())
      .send({ branchId })
      .expect(200);
  });

  it('runs an ADJUST stocktake', async () => {
    const created = await http()
      .post('/stock-movements')
      .set(auth())
      .send({
        movementType: 'ADJUST',
        fromLocation: { locationId: branchId, locationType: 'branch' },
        details: [{ productItemId: itemAId, receivedQuantity: 24 }],
      })
      .expect(201);
    expect(created.body.status).toBe('PENDING');
    expect(created.body.details[0].quantity).toBe(26);
    note(
      `POST ADJUST: system quantity filled in from inventory = ${created.body.details[0].quantity} OK`,
    );

    await http()
      .patch(`/stock-movements/${created.body.id}/approve-adjust`)
      .set(auth())
      .expect(200);

    const after = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });
    expect(after?.stock).toBe(24);
    note(`approve-adjust: branch 26 → ${after?.stock} (shrinkage of 2) OK`);
  });

  it('keeps a staff account inside its own location', async () => {
    const login = await http()
      .post('/auth/login')
      .send({ phoneNumber: PHONE_STAFF, password: 'newpass123' })
      .expect(201);
    const staffToken = login.body.accessToken;

    const list = await http()
      .get('/stock-movements')
      .set(auth(staffToken))
      .expect(200);
    note(
      `staff GET /stock-movements: sees ${list.body.pagination.total} of the tenant's movements (own branch only)`,
    );

    await http()
      .post('/stock-movements')
      .set(auth(staffToken))
      .send({
        movementType: 'EXPORT',
        fromLocation: { locationId: warehouseId, locationType: 'warehouse' },
        toLocation: { locationId: branchId, locationType: 'branch' },
        details: [{ productItemId: itemAId, quantity: 1 }],
      })
      .expect(403);
    note('staff creating a movement out of another location: 403 OK');

    await http().get('/products').set(auth(staffToken)).expect(403);
    note('staff without products:read on /products: 403 OK');
  });

  it('rings up a cash sale, computing the total server-side', async () => {
    const before = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });

    const sale = await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'CASH',
        customerPay: 500_000,
        // grandTotal is deliberately NOT sent — and would be ignored if it were.
        items: [{ productItemId: itemAId, quantity: 2, unitPrice: 200_000 }],
      })
      .expect(201);

    expect(sale.body.order.grandTotal).toBe(400_000);
    expect(sale.body.order.change).toBe(100_000);
    expect(sale.body.order.status).toBe('COMPLETED');
    expect(sale.body.order.paymentReference).toMatch(/^ORD/);
    orderId = sale.body.order.id;
    note(
      `POST /orders CASH: total computed = ${sale.body.order.grandTotal}, change ${sale.body.order.change}, ref ${sale.body.order.paymentReference} OK`,
    );

    const after = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });
    expect(after!.stock).toBe(before!.stock - 2);
    note(`sale decremented branch stock ${before!.stock} → ${after!.stock} OK`);

    // Cash with change is two rows: the drawer took the note and gave some back.
    const flows = await prisma.cashFlow.findMany({
      where: { tenantId, paymentReference: sale.body.order.paymentReference },
      select: { flowType: true, amount: true, orderId: true },
    });
    expect(flows).toHaveLength(2);
    const income = flows.find((f) => f.flowType === 'INCOME')!;
    const expense = flows.find((f) => f.flowType === 'EXPENSE')!;
    expect(Number(income.amount)).toBe(500_000);
    expect(Number(expense.amount)).toBe(100_000);
    expect(income.orderId).toBe(orderId);
    expect(expense.orderId).toBeNull();
    note(
      'cash flows: INCOME 500k (linked) + EXPENSE 100k change (unlinked, keeps the unique index free for a refund) OK',
    );
  });

  it('refuses a sale the branch cannot cover, and one the customer underpays', async () => {
    await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'CASH',
        items: [{ productItemId: itemAId, quantity: 9999, unitPrice: 1000 }],
      })
      .expect(400);
    note('POST /orders beyond branch stock: 400 OK');

    await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'CASH',
        customerPay: 1_000,
        items: [{ productItemId: itemAId, quantity: 1, unitPrice: 200_000 }],
      })
      .expect(400);
    note('POST /orders with customerPay below the total: 400 OK');
  });

  it('returns a completed sale, putting stock and money back', async () => {
    const before = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });

    await http()
      .patch(`/orders/${orderId}/status`)
      .set(auth())
      .send({ status: 'CANCELLED' })
      .expect(409);
    note('COMPLETED → CANCELLED: 409 OK (not a legal transition)');

    await http()
      .patch(`/orders/${orderId}/status`)
      .set(auth())
      .send({ status: 'RETURNED' })
      .expect(200);

    const after = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });
    expect(after!.stock).toBe(before!.stock + 2);

    const refund = await prisma.cashFlow.findFirst({
      where: { tenantId, orderId, flowType: 'EXPENSE' },
      select: { amount: true },
    });
    expect(Number(refund!.amount)).toBe(400_000);
    note(
      `RETURNED: stock ${before!.stock} → ${after!.stock} and a 400k refund row OK`,
    );

    await http()
      .patch(`/orders/${orderId}/status`)
      .set(auth())
      .send({ status: 'COMPLETED' })
      .expect(409);
    note('RETURNED is terminal: 409 OK');
  });

  it('opens a SePay sale as PENDING and settles it offline', async () => {
    await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'SEPAY',
        items: [{ productItemId: itemAId, quantity: 1, unitPrice: 200_000 }],
      })
      .expect(400);
    note('SEPAY sale without tenant banking configured: 400 OK');

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        bankingBankName: 'MB',
        bankingAccountNumber: '0000000000',
        bankingAccountName: 'SMOKE TEST',
      },
    });

    const sale = await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'SEPAY',
        items: [{ productItemId: itemAId, quantity: 1, unitPrice: 200_000 }],
      })
      .expect(201);
    expect(sale.body.order.status).toBe('PENDING');
    expect(sale.body.qrUrl).toContain('img.vietqr.io');
    note(
      'POST /orders SEPAY: PENDING + QR built from the tenant bank details OK',
    );

    const settled = await http()
      .post(`/orders/${sale.body.order.id}/pay-offline`)
      .set(auth())
      .send({ paymentMethod: 'CASH', customerPay: 200_000 })
      .expect(200);
    expect(settled.body.status).toBe('COMPLETED');
    expect(settled.body.paymentMethod).toBe('CASH');
    note('pay-offline: SEPAY order settled as CASH, COMPLETED OK');

    await http()
      .post(`/orders/${sale.body.order.id}/pay-offline`)
      .set(auth())
      .send({ paymentMethod: 'CASH' })
      .expect(409);
    note('pay-offline twice: 409 OK (cannot double-charge)');
  });

  it('settles a SePay sale from the webhook', async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { bankingSepayWebhookApiKey: 'smoke-webhook-key' },
    });

    const sale = await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'SEPAY',
        items: [{ productItemId: itemAId, quantity: 1, unitPrice: 150_000 }],
      })
      .expect(201);
    const reference = sale.body.order.paymentReference;

    // Unknown key: answered 200 so SePay stops, but nothing is settled.
    const unknown = await http()
      .post('/webhook/sepay/order')
      .set({ Authorization: 'Apikey wrong-key' })
      .send({ transferType: 'in', content: reference, transferAmount: 150_000 })
      .expect(200);
    expect(unknown.body.success).toBe(false);
    note('webhook with an unknown API key: 200 + success:false OK');

    const paid = await http()
      .post('/webhook/sepay/order')
      .set({ Authorization: 'Apikey smoke-webhook-key' })
      .send({
        transferType: 'in',
        content: `Chuyen khoan ${reference}`,
        transferAmount: 150_000,
        id: 987654,
      })
      .expect(200);
    expect(paid.body.success).toBe(true);

    const settled = await prisma.order.findUnique({
      where: { id: sale.body.order.id },
      select: { status: true },
    });
    expect(settled!.status).toBe('COMPLETED');
    note('webhook: reference extracted from free text, order COMPLETED OK');

    const replay = await http()
      .post('/webhook/sepay/order')
      .set({ Authorization: 'Apikey smoke-webhook-key' })
      .send({
        transferType: 'in',
        content: reference,
        transferAmount: 150_000,
        id: 987654,
      })
      .expect(200);
    expect(replay.body.success).toBe(false);
    const flowCount = await prisma.cashFlow.count({
      where: { tenantId, orderId: sale.body.order.id, flowType: 'INCOME' },
    });
    expect(flowCount).toBe(1);
    note('webhook replay: refused, still exactly 1 income row OK');
  });

  it('prices a cart against a promotion and commits it once', async () => {
    const promotion = await http()
      .post('/promotions')
      .set(auth())
      .send({
        promoName: 'Giảm 10% toàn shop',
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscountAmount: 50_000,
        applicableRule: { type: 'all' },
        startDate: '2026-08-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        usageLimit: 1,
      })
      .expect(201);
    promotionId = promotion.body.id;
    expect(promotion.body.applicableRule.type).toBe('all');
    note('POST /promotions: OK');

    const cart = {
      branchId,
      items: [{ productItemId: itemAId, quantity: 3, unitPrice: 200_000 }],
    };

    const candidates = await http()
      .post('/promotions/candidates')
      .set(auth())
      .send(cart)
      .expect(200);
    expect(candidates.body.systemPromotions).toHaveLength(1);
    expect(candidates.body.systemPromotions[0].eligible).toBe(true);
    note(
      `POST /promotions/candidates: 1 tenant-wide candidate, preview ${candidates.body.systemPromotions[0].previewDiscount} OK`,
    );

    const calculated = await http()
      .post('/promotions/calculate')
      .set(auth())
      .send({ ...cart, promotionIds: [promotionId] })
      .expect(200);
    // 10% of 600k = 60k, capped at 50k.
    expect(calculated.body.totalDiscount).toBe(50_000);
    expect(calculated.body.grandTotal).toBe(550_000);
    note(
      'POST /promotions/calculate: 10% of 600k capped at maxDiscountAmount 50k OK',
    );

    const withDiscount = await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'CASH',
        discountType: 'PROMOTION',
        discountValue: 50_000,
        items: [
          {
            productItemId: itemAId,
            quantity: 3,
            unitPrice: 200_000,
            discountAmount: calculated.body.itemBreakdown[0].discountAmount,
          },
        ],
        appliedPromotions: [
          {
            promotionId,
            promoName: 'Giảm 10% toàn shop',
            discountAmount: 50_000,
          },
        ],
      })
      .expect(201);
    expect(withDiscount.body.order.grandTotal).toBe(550_000);
    note(
      'POST /orders with a promotion: server total 550k matches the preview OK (no double deduction)',
    );

    const applied = await http()
      .post('/promotions/apply')
      .set(auth())
      .send({
        ...cart,
        orderId: withDiscount.body.order.id,
        promotionIds: [promotionId],
      })
      .expect(200);
    expect(applied.body.appliedPromotions).toHaveLength(1);

    const after = await prisma.promotion.findUnique({
      where: { id: promotionId },
      select: { usedCount: true },
    });
    expect(after!.usedCount).toBe(1);
    note('POST /promotions/apply: usedCount 0 → 1 and a log written OK');

    const logs = await http()
      .get(`/promotions/${promotionId}/logs`)
      .set(auth())
      .expect(200);
    expect(logs.body.pagination.total).toBe(1);
    expect(logs.body.data[0].paymentReference).toMatch(/^ORD/);
    note('GET /promotions/:id/logs: 1 entry, order reference resolved OK');
  });

  it('stops a promotion being used past its limit', async () => {
    const cart = {
      branchId,
      items: [{ productItemId: itemAId, quantity: 1, unitPrice: 200_000 }],
    };

    // usageLimit was 1 and the previous test consumed it, so it is no longer eligible.
    const calc = await http()
      .post('/promotions/calculate')
      .set(auth())
      .send({ ...cart, promotionIds: [promotionId] })
      .expect(400);
    expect(calc.body.message).toContain('hết lượt');
    note('exhausted promotion: 400 with a reason OK');

    const candidates = await http()
      .post('/promotions/candidates')
      .set(auth())
      .send(cart)
      .expect(200);
    expect(candidates.body.systemPromotions[0].eligible).toBe(false);
    note(
      `candidates still lists it, ineligible: "${candidates.body.systemPromotions[0].reason}" OK`,
    );
  });

  it('scopes promotions to the branches they name', async () => {
    const other = await http()
      .post('/branches')
      .set(auth())
      .send({ name: 'CN Q7', phoneNumber: ['0987650012'] })
      .expect(201);

    await http()
      .post('/promotions')
      .set(auth())
      .send({
        promoName: 'Chỉ CN Q7',
        branchIds: [other.body.id],
        discountType: 'FIXED_AMOUNT',
        discountValue: 20_000,
        applicableRule: { type: 'all' },
        startDate: '2026-08-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
      })
      .expect(201);

    const atQ1 = await http()
      .post('/promotions/candidates')
      .set(auth())
      .send({
        branchId,
        items: [{ productItemId: itemAId, quantity: 1, unitPrice: 200_000 }],
      })
      .expect(200);
    expect(atQ1.body.branchPromotions).toHaveLength(0);
    note('branch-scoped promotion is not a candidate at another branch OK');

    await http()
      .post('/promotions')
      .set(auth())
      .send({
        promoName: 'Sai ngày',
        discountType: 'PERCENT',
        discountValue: 10,
        applicableRule: { type: 'all' },
        startDate: '2026-12-31T00:00:00.000Z',
        endDate: '2026-08-01T00:00:00.000Z',
      })
      .expect(400);
    note('promotion ending before it starts: 400 OK');

    await http()
      .post('/promotions')
      .set(auth())
      .send({
        promoName: 'Cap sai kiểu',
        discountType: 'FIXED_AMOUNT',
        discountValue: 10_000,
        maxDiscountAmount: 5_000,
        applicableRule: { type: 'all' },
        startDate: '2026-08-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
      })
      .expect(400);
    note('maxDiscountAmount on a FIXED_AMOUNT promotion: 400 OK');
  });

  it('manages customers and attaches a walk-in to anonymous sales', async () => {
    const walkIn = await prisma.customer.findFirst({
      where: { tenantId, customerCode: 'KH_VANGLAI' },
      select: { id: true, name: true },
    });
    expect(walkIn).toBeTruthy();
    note(`walk-in customer auto-created once: "${walkIn!.name}" OK`);

    const created = await http()
      .post('/customers')
      .set(auth())
      .send({
        name: 'Nguyễn Văn A',
        phone: '0912345678',
        customerCode: 'KH001',
      })
      .expect(201);

    await http()
      .post('/customers')
      .set(auth())
      .send({ name: 'Trùng mã', customerCode: 'KH001' })
      .expect(409);
    note('duplicate customerCode: 409 OK');

    const list = await http()
      .get('/customers?search=0912')
      .set(auth())
      .expect(200);
    expect(list.body.pagination.total).toBe(1);
    note('GET /customers?search: OK');

    const sale = await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        customerId: created.body.id,
        paymentMethod: 'CASH',
        items: [{ productItemId: itemAId, quantity: 1, unitPrice: 100_000 }],
      })
      .expect(201);
    expect(sale.body.order.customer.id).toBe(created.body.id);

    const withOrders = await http()
      .get(`/customers?search=0912`)
      .set(auth())
      .expect(200);
    expect(withOrders.body.data[0].orders).toHaveLength(1);
    note('GET /customers carries the order history OK');

    await http()
      .delete(`/customers/${created.body.id}`)
      .set(auth())
      .expect(200);
    await http().get(`/customers/${created.body.id}`).set(auth()).expect(404);
    note('soft delete: gone from reads, row kept for the order OK');
  });

  it('refuses a promotion from another tenant on an order', async () => {
    // The FK would accept it — it is a real promotion id, just not this tenant's.
    const outsider = await prisma.promotion.findFirst({
      where: { tenantId: { not: tenantId } },
      select: { id: true },
    });

    await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'CASH',
        appliedPromotions: [
          {
            promotionId: outsider?.id ?? '11111111-1111-4111-8111-111111111111',
          },
        ],
        items: [{ productItemId: itemAId, quantity: 1, unitPrice: 100_000 }],
      })
      .expect(404);
    note("order carrying another tenant's promotion id: 404 OK");
  });

  it('scopes order reads to the branch a staff account works at', async () => {
    const login = await http()
      .post('/auth/login')
      .send({ phoneNumber: PHONE_STAFF, password: 'newpass123' })
      .expect(201);
    const staffToken = login.body.accessToken;

    // The staff role has no orders:* yet — grant read only, no view_all.
    await http()
      .patch(`/roles/${roleId}`)
      .set(auth())
      .send({
        permissions: [
          { resource: 'stock_movement', action: 'create' },
          { resource: 'stock_movement', action: 'read' },
          { resource: 'orders', action: 'read' },
        ],
      })
      .expect(200);

    const ownBranch = await http()
      .get('/orders')
      .set(auth(staffToken))
      .expect(200);
    const otherBranchOrders = ownBranch.body.data.filter(
      (o: any) => o.branchId !== branchId,
    );
    expect(otherBranchOrders).toHaveLength(0);
    note(
      `staff GET /orders: ${ownBranch.body.pagination.total} orders, all from their own branch OK`,
    );

    const ownerView = await http().get('/orders').set(auth()).expect(200);
    expect(ownerView.body.pagination.total).toBeGreaterThanOrEqual(
      ownBranch.body.pagination.total,
    );
    note('owner still sees every branch OK (view_all short-circuit)');
  });

  it('refuses to sell more than the shelf holds, from inside the write', async () => {
    const line = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });

    await http()
      .post('/orders')
      .set(auth())
      .send({
        branchId,
        paymentMethod: 'CASH',
        items: [
          {
            productItemId: itemAId,
            quantity: line!.stock + 1,
            unitPrice: 1_000,
          },
        ],
      })
      .expect(400);

    const unchanged = await prisma.inventory.findFirst({
      where: { tenantId, branchId, productItemId: itemAId },
      select: { stock: true },
    });
    expect(unchanged!.stock).toBe(line!.stock);
    note(
      `oversell by 1 (${line!.stock} on hand): 400 and stock untouched OK (guard is in the UPDATE)`,
    );
  });

  it('keeps exactly one walk-in customer under concurrent anonymous sales', async () => {
    const sale = () =>
      http()
        .post('/orders')
        .set(auth())
        .send({
          branchId,
          paymentMethod: 'CASH',
          items: [{ productItemId: itemAId, quantity: 1, unitPrice: 10_000 }],
        });

    const results = await Promise.all([sale(), sale(), sale()]);
    for (const result of results) expect(result.status).toBe(201);

    const walkIns = await prisma.customer.count({
      where: { tenantId, customerCode: 'KH_VANGLAI' },
    });
    expect(walkIns).toBe(1);
    note(
      '3 concurrent anonymous sales → exactly 1 walk-in customer row OK (upsert, not find-then-create)',
    );
  });

  it('runs a cash drawer through a full day, including a handover', async () => {
    // Staff needs the till permissions for this scenario.
    await http()
      .patch(`/roles/${roleId}`)
      .set(auth())
      .send({
        permissions: [
          { resource: 'orders', action: 'read' },
          { resource: 'cash_drawers', action: 'read_own' },
          { resource: 'cash_drawers', action: 'report' },
        ],
      })
      .expect(200);

    // A second cashier to hand over to.
    const secondStaff = await http()
      .post('/users')
      .set(auth())
      .send({
        phoneNumber: '0987650003',
        password: 'password123',
        roleId,
        branchId,
      })
      .expect(201);

    const opened = await http()
      .post('/cash-drawer-sessions')
      .set(auth())
      .send({ branchId, staffId, openingAmount: 2_000_000 })
      .expect(201);
    secondStaffId = secondStaff.body.id;
    sessionId = opened.body.id;
    expect(opened.body.status).toBe('OPEN');
    expect(opened.body.openingAmount).toBe(2_000_000);
    expect(opened.body.currentStaff.id).toBe(staffId);
    note(
      `POST /cash-drawer-sessions: OPEN, float ${opened.body.openingAmount}, held by staff 1 OK`,
    );

    await http()
      .post('/cash-drawer-sessions')
      .set(auth())
      .send({ branchId, staffId, openingAmount: 1_000 })
      .expect(409);
    note('second drawer at the same branch: 409 OK (partial unique index)');

    const staffLogin = await http()
      .post('/auth/login')
      .send({ phoneNumber: PHONE_STAFF, password: 'newpass123' })
      .expect(201);
    const staffToken = staffLogin.body.accessToken;

    const second = await http()
      .post('/auth/login')
      .send({ phoneNumber: '0987650003', password: 'password123' })
      .expect(201);
    const secondToken = second.body.accessToken;

    // Only whoever holds the drawer may write to it.
    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(secondToken))
      .send({ type: 'START', amount: 2_000_000 })
      .expect(404);
    note('a cashier who never held the drawer cannot even see it: 404 OK');

    // END before START is out of sequence.
    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(staffToken))
      .send({ type: 'END', amount: 2_000_000 })
      .expect(409);
    note('END before START: 409 OK (sequence enforced)');

    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(staffToken))
      .send({ type: 'START', amount: 2_000_000 })
      .expect(200);

    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(staffToken))
      .send({ type: 'START', amount: 2_000_000 })
      .expect(409);
    note('a second START on the same shift: 409 OK');

    // Finalizing mid-shift is refused — the last log is a START.
    await http()
      .post(`/cash-drawer-sessions/${sessionId}/finalize`)
      .set(auth())
      .send({ finalAmount: 2_500_000 })
      .expect(409);
    note('finalize with a shift still open: 409 OK');

    // Hand over to the second cashier.
    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(staffToken))
      .send({
        type: 'END',
        amount: 2_400_000,
        nextStaffId: secondStaff.body.id,
      })
      .expect(200);

    const afterHandover = await prisma.cashDrawerSession.findUnique({
      where: { id: sessionId },
      select: { currentStaffId: true, status: true },
    });
    expect(afterHandover!.currentStaffId).toBe(secondStaff.body.id);
    expect(afterHandover!.status).toBe('OPEN');
    note('handover: drawer passed to cashier 2, session still OPEN OK');

    // The first cashier no longer holds it.
    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(staffToken))
      .send({ type: 'START', amount: 2_400_000 })
      .expect(403);
    note('the outgoing cashier can no longer write to the drawer: 403 OK');

    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(secondToken))
      .send({ type: 'START', amount: 2_400_000 })
      .expect(200);
    await http()
      .post(`/cash-drawer-sessions/${sessionId}/shift-logs`)
      .set(auth(secondToken))
      .send({ type: 'END', amount: 3_100_000 })
      .expect(200);
    note('cashier 2 worked a shift and closed it out OK');

    const finalized = await http()
      .post(`/cash-drawer-sessions/${sessionId}/finalize`)
      .set(auth())
      .send({ finalAmount: 3_100_000, note: 'Khớp' })
      .expect(200);
    expect(finalized.body.status).toBe('CLOSED');
    expect(finalized.body.finalLog.amount).toBe(3_100_000);
    expect(finalized.body.shiftLogs).toHaveLength(4);
    note(
      `finalize: CLOSED, final count ${finalized.body.finalLog.amount}, ${finalized.body.shiftLogs.length} shift logs OK`,
    );

    await http()
      .post(`/cash-drawer-sessions/${sessionId}/finalize`)
      .set(auth())
      .send({ finalAmount: 3_100_000 })
      .expect(409);
    note('finalize twice: 409 OK');
  });

  it('lets a branch open a new drawer once the previous one is closed', async () => {
    // The old schema's plain unique on (tenant, branch, status) made this impossible from
    // the second day onwards — a branch could only ever hold one CLOSED session.
    const previous = await prisma.cashDrawerSession.findUnique({
      where: { id: sessionId },
      select: { businessDate: true },
    });
    // Move yesterday's session off today's date so the per-day unique doesn't fire.
    await prisma.cashDrawerSession.update({
      where: { id: sessionId },
      data: { businessDate: new Date('2026-08-25T00:00:00.000Z') },
    });

    const reopened = await http()
      .post('/cash-drawer-sessions')
      .set(auth())
      .send({ branchId, staffId: secondStaffId, openingAmount: 500_000 })
      .expect(201);
    expect(reopened.body.status).toBe('OPEN');
    note(
      `a second session at the same branch after the first closed: OK (was impossible before the partial index; previous day ${previous!.businessDate.toISOString().slice(0, 10)})`,
    );

    const closedList = await http()
      .get('/cash-drawer-sessions?status=CLOSED')
      .set(auth())
      .expect(200);
    expect(closedList.body.pagination.total).toBe(1);
    expect(closedList.body.data[0].shiftLogCount).toBe(4);
    note(
      'GET /cash-drawer-sessions?status=CLOSED: summary carries shiftLogCount OK',
    );

    const current = await http()
      .get(`/cash-drawer-sessions/current?branchId=${branchId}`)
      .set(auth())
      .expect(200);
    expect(current.body.id).toBe(reopened.body.id);
    note('GET /cash-drawer-sessions/current returns the open one OK');
  });

  it('keeps a cashier to the sessions they actually worked', async () => {
    const staffLogin = await http()
      .post('/auth/login')
      .send({ phoneNumber: PHONE_STAFF, password: 'newpass123' })
      .expect(201);

    // The role holds read_own, not read — cashier 1 worked the first session only.
    const mine = await http()
      .get('/cash-drawer-sessions')
      .set(auth(staffLogin.body.accessToken))
      .expect(200);
    expect(mine.body.pagination.total).toBe(1);
    expect(mine.body.data[0].id).toBe(sessionId);
    note(
      "read_own: cashier sees only the session they worked, not the branch's newest one OK",
    );

    const ownerView = await http()
      .get('/cash-drawer-sessions')
      .set(auth())
      .expect(200);
    expect(ownerView.body.pagination.total).toBe(2);
    note('owner sees both sessions OK');
  });

  it('rejects a duplicate shift log sent twice at once', async () => {
    // The guard has to advance even when nothing about the session changes — a START or a
    // no-handover END writes only to the shift-log table. Before the fix, `updateMany` with
    // an empty `data` matched the row without touching `updatedAt`, so a double tap or a
    // client retry produced two identical logs and a shortfall stopped being attributable.
    const opened = await prisma.cashDrawerSession.findFirstOrThrow({
      where: { tenantId, status: 'OPEN' },
      select: { id: true, currentStaffId: true },
    });

    const holder = await prisma.user.findUniqueOrThrow({
      where: { id: opened.currentStaffId },
      select: { phoneNumber: true },
    });
    const login = await http()
      .post('/auth/login')
      .send({
        phoneNumber: holder.phoneNumber,
        password:
          holder.phoneNumber === PHONE_STAFF ? 'newpass123' : 'password123',
      })
      .expect(201);
    const holderToken = login.body.accessToken;

    const submit = () =>
      http()
        .post(`/cash-drawer-sessions/${opened.id}/shift-logs`)
        .set(auth(holderToken))
        .send({ type: 'START', amount: 500_000 });

    const [a, b] = await Promise.all([submit(), submit()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const logs = await prisma.cashDrawerShiftLog.count({
      where: { sessionId: opened.id, type: 'START' },
    });
    expect(logs).toBe(1);
    note(
      `two identical START logs at once: ${statuses.join(' + ')}, exactly 1 log written OK`,
    );
  });

  it('refuses a staff account that belongs to no branch', async () => {
    // A cashier granted cash_drawers:read but never posted to a branch used to fall through
    // to "no branch filter" and see every till in the tenant.
    await http()
      .patch(`/roles/${roleId}`)
      .set(auth())
      .send({
        permissions: [
          { resource: 'cash_drawers', action: 'read' },
          { resource: 'cash_drawers', action: 'report' },
        ],
      })
      .expect(200);

    const drifter = await http()
      .post('/users')
      .set(auth())
      .send({
        phoneNumber: '0987650004',
        password: 'password123',
        roleId,
        branchId,
      })
      .expect(201);

    // Take their posting away.
    await prisma.user.update({
      where: { id: drifter.body.id },
      data: { branchId: null },
    });

    const login = await http()
      .post('/auth/login')
      .send({ phoneNumber: '0987650004', password: 'password123' })
      .expect(201);

    await http()
      .get('/cash-drawer-sessions')
      .set(auth(login.body.accessToken))
      .expect(403);
    note('unposted staff with cash_drawers:read listing tills: 403 OK');

    const anySession = await prisma.cashDrawerSession.findFirstOrThrow({
      where: { tenantId },
      select: { id: true },
    });
    await http()
      .get(`/cash-drawer-sessions/${anySession.id}`)
      .set(auth(login.body.accessToken))
      .expect(403);
    note('...and reading one by id: 403 OK');
  });

  it('refuses to discontinue a product that still has stock', async () => {
    const blocked = await http()
      .delete(`/products/${productId}`)
      .set(auth())
      .expect(400);
    expect(blocked.body.message).toContain('tồn kho');
    note('DELETE /products/:id with stock: 400 OK');
  });
});
