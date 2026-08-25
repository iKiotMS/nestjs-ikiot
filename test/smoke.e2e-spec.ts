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

  it('refuses to discontinue a product that still has stock', async () => {
    const blocked = await http()
      .delete(`/products/${productId}`)
      .set(auth())
      .expect(400);
    expect(blocked.body.message).toContain('tồn kho');
    note('DELETE /products/:id with stock: 400 OK');
  });
});
