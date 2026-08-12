// One-off codegen script: reads prisma/schema.prisma and scaffolds a NestJS
// module (module/controller/service/dto) for every top-level model, wired to
// PrismaService with basic CRUD. Child/join tables (managed as nested writes
// within their parent's service, not their own routes) are excluded via
// CHILD_MODELS below. Run once with `node scripts/generate-modules.js`, then
// delete this script — it is not meant to be re-run against a hand-edited
// schema without re-checking its output.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');

const SCALAR_TYPES = new Set(['String', 'Int', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json']);

const CHILD_MODELS = new Set([
  'UserFcmToken', 'SubscriptionHistoryLog',
  'ProductImage', 'ProductItemSupplier', 'ProductItemDetail', 'ProductItemImage',
  'StockMovementRequestItem',
  'WorkingScheduleUser', 'LeaveRequestHandoverSchedule',
  'PaysheetBonus', 'PaysheetBonusTier', 'PaysheetAllowance', 'PaysheetDeduction',
  'PayslipLeaveLine', 'PayslipLeaveLineDate', 'PayslipAllowanceLine',
  'PayslipDeductionLine', 'PayslipManualAdjustment',
  'OrderItem', 'OrderAppliedPromotion',
  'PromotionBranch', 'PromotionCategory', 'PromotionProductItem',
  'CashDrawerShiftLog',
  'NotificationTargetTenant', 'TicketMessage',
]);

function parseModels(src) {
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  const models = [];
  let m;
  while ((m = modelRe.exec(src))) {
    const [, name, body] = m;
    models.push({ name, body });
  }
  return models;
}

function parseTableName(body) {
  const m = body.match(/@@map\("([^"]+)"\)/);
  return m ? m[1] : null;
}

function parseFields(body) {
  const fields = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
    const fm = line.match(/^(\w+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?\s*(.*)$/);
    if (!fm) continue;
    const [, fieldName, baseType, isArray, isOptional] = fm;
    if (!SCALAR_TYPES.has(baseType)) continue; // relation field, skip
    if (line.includes('@relation(')) continue;
    fields.push({ name: fieldName, type: baseType, array: !!isArray, optional: !!isOptional });
  }
  return fields;
}

function toKebab(tableName) {
  return tableName.replace(/_/g, '-');
}

function toClientProp(modelName) {
  return modelName[0].toLowerCase() + modelName.slice(1);
}

function toPascalFromKebab(kebab) {
  return kebab.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

const TS_TYPE = { String: 'string', Int: 'number', Float: 'number', Decimal: 'number', Boolean: 'boolean', DateTime: 'string', Json: 'any' };
const VALIDATOR = { String: 'IsString', Int: 'IsInt', Float: 'IsNumber', Decimal: 'IsNumber', Boolean: 'IsBoolean', DateTime: 'IsDateString', Json: 'IsObject' };

function buildDtoField(f) {
  const decorators = [];
  const importSet = new Set();
  if (f.optional) {
    decorators.push('@IsOptional()');
    importSet.add('IsOptional');
  }
  if (f.array) {
    decorators.push('@IsArray()');
    importSet.add('IsArray');
    const inner = VALIDATOR[f.type];
    if (inner && inner !== 'IsObject') {
      decorators.push(`@${inner}({ each: true })`);
      importSet.add(inner);
    }
  } else {
    const dec = VALIDATOR[f.type];
    if (dec) {
      decorators.push(`@${dec}()`);
      importSet.add(dec);
    }
  }
  const tsType = TS_TYPE[f.type] + (f.array ? '[]' : '');
  const qMark = f.optional ? '?' : '';
  const code = `  ${decorators.join('\n  ')}\n  ${f.name}${qMark}: ${tsType};`;
  return { code, imports: importSet };
}

const models = parseModels(schema).filter((m) => !CHILD_MODELS.has(m.name));

for (const model of models) {
  const tableName = parseTableName(model.body);
  if (!tableName) continue;
  const kebab = toKebab(tableName);
  const pascal = toPascalFromKebab(kebab); // e.g. leave-requests -> LeaveRequests -> singularize below
  const singularPascal = model.name; // authoritative singular name from the schema itself
  const clientProp = toClientProp(model.name);
  const fields = parseFields(model.body).filter((f) => !['id', 'createdAt', 'updatedAt'].includes(f.name));
  const hasTenant = fields.some((f) => f.name === 'tenantId');

  const dir = path.join(ROOT, 'src', 'modules', kebab);
  const dtoDir = path.join(dir, 'dto');
  fs.mkdirSync(dtoDir, { recursive: true });

  // ---- create DTO ----
  const allImports = new Set();
  const dtoFieldsCode = fields.map((f) => {
    const { code, imports } = buildDtoField(f);
    imports.forEach((i) => allImports.add(i));
    return code;
  }).join('\n\n');
  const createDtoName = `Create${singularPascal}Dto`;
  const createDtoContent = `import { ${[...allImports].sort().join(', ')} } from 'class-validator';

export class ${createDtoName} {
${dtoFieldsCode || '  // no client-settable scalar fields on this model'}
}
`;
  fs.writeFileSync(path.join(dtoDir, `create-${kebab}.dto.ts`), createDtoContent.replace(/^import \{ \} from 'class-validator';\n\n/, ''));

  // ---- update DTO ----
  const updateDtoName = `Update${singularPascal}Dto`;
  const updateDtoContent = `import { PartialType } from '@nestjs/mapped-types';
import { ${createDtoName} } from './create-${kebab}.dto';

export class ${updateDtoName} extends PartialType(${createDtoName}) {}
`;
  fs.writeFileSync(path.join(dtoDir, `update-${kebab}.dto.ts`), updateDtoContent);

  // ---- service ----
  const serviceName = `${singularPascal}Service`;
  const findAllWhere = hasTenant ? 'tenantId ? { where: { tenantId } } : undefined' : 'undefined';
  const serviceContent = `import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ${createDtoName} } from './dto/create-${kebab}.dto';
import { ${updateDtoName} } from './dto/update-${kebab}.dto';

@Injectable()
export class ${serviceName} {
  constructor(private readonly prisma: PrismaService) {}

  findAll(${hasTenant ? 'tenantId?: string' : ''}) {
    return this.prisma.${clientProp}.findMany(${findAllWhere});
  }

  findOne(id: string) {
    return this.prisma.${clientProp}.findUniqueOrThrow({ where: { id } });
  }

  create(data: ${createDtoName}) {
    return this.prisma.${clientProp}.create({ data: data as any });
  }

  update(id: string, data: ${updateDtoName}) {
    return this.prisma.${clientProp}.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.${clientProp}.delete({ where: { id } });
  }
}
`;
  fs.writeFileSync(path.join(dir, `${kebab}.service.ts`), serviceContent);

  // ---- controller ----
  const controllerName = `${singularPascal}Controller`;
  const controllerContent = `import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ${serviceName} } from './${kebab}.service';
import { ${createDtoName} } from './dto/create-${kebab}.dto';
import { ${updateDtoName} } from './dto/update-${kebab}.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@Controller('${kebab}')
export class ${controllerName} {
  constructor(private readonly service: ${serviceName}) {}

  @Get()
  findAll(${hasTenant ? "@Query('tenantId') tenantId?: string" : ''}) {
    return this.service.findAll(${hasTenant ? 'tenantId' : ''});
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: ${createDtoName}) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: ${updateDtoName}) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
`;
  fs.writeFileSync(path.join(dir, `${kebab}.controller.ts`), controllerContent);

  // ---- module ----
  const moduleName = `${singularPascal}Module`;
  const moduleContent = `import { Module } from '@nestjs/common';
import { ${controllerName} } from './${kebab}.controller';
import { ${serviceName} } from './${kebab}.service';

@Module({
  controllers: [${controllerName}],
  providers: [${serviceName}],
  exports: [${serviceName}],
})
export class ${moduleName} {}
`;
  fs.writeFileSync(path.join(dir, `${kebab}.module.ts`), moduleContent);
}

console.log(`Generated ${models.length} modules.`);
console.log(models.map((m) => `  - ${m.name} -> src/modules/${toKebab(parseTableName(m.body))}`).join('\n'));
