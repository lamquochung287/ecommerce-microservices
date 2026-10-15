# Code Standards & Conventions

**Ngày cập nhật**: 2026-09-28

Tài liệu này định nghĩa các quy tắc lập trình bắt buộc và convention được áp dụng trên toàn bộ dự án. Tuân thủ các quy tắc này để đảm bảo consistency, maintainability, và quality.

## 1. Validation (Kiểm tra Dữ liệu)

### Nguyên tắc
- **Tất cả DTOs bắt buộc sử dụng class-validator decorators** (e.g., `@IsString()`, `@IsEmail()`, `@IsNotEmpty()`, `@Min()`, `@Max()`)
- **Global ValidationPipe** đã được thiết lập trong `gateway/main.ts` với option:
  ```ts
  new ValidationPipe({
    whitelist: true,           // Loại bỏ props không định nghĩa trong DTO
    forbidNonWhitelisted: true, // Throw nếu có props lạ
    transform: true,            // Auto-transform payload sang DTO class
  })
  ```
- **Không cần** kiểm tra null/undefined thủ công ở level controller nếu DTO đã quy định (do ValidationPipe xử lý)

### Ví dụ
```ts
// ✅ ĐÚNG
export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  description?: string;
}

// ❌ SAI (bỏ qua class-validator)
export class CreateProductDto {
  name: string; // Không có @IsString(), @IsNotEmpty()
  price: number; // Không có @IsNumber(), @Min(0)
}
```

### Tư Duy
- ValidationPipe chạy trước controller method → nếu validation fails, trả 400 Bad Request ngay (không vào handler)
- Ưu tiên: class-validator decorators > manual validation code

---

## 2. Error Handling (Xử lý Ngoại lệ)

### Trong Microservices (không phải Gateway)
- **Throw `RpcException` hoặc NestJS built-in exceptions** (`BadRequestException`, `NotFoundException`, `UnauthorizedException`, v.v.)
- Không bao giờ throw plain `Error` hoặc string
- Lỗi sẽ được **`AbstractRpcExceptionFilter`** (hoặc subclass per-service) đón và format lại thành RPC-safe object (statusCode, message, error, timestamp)

```ts
// ✅ ĐÚNG (trong microservice)
throw new NotFoundException('Product not found');
throw new BadRequestException('Invalid email');
throw new RpcException({ statusCode: 500, message: 'Custom error' });

// ❌ SAI
throw new Error('Something went wrong'); // Plain Error
throw 'Invalid input'; // String throw
```

### Trong Gateway
- **Sử dụng `HttpExceptionFilter`** (đã setup global trong main.ts)
- Filter này map RPC errors từ microservices → HTTP status code phù hợp
- Response format: `{success, data, error, message, meta}` (thông qua TransformInterceptor)

```ts
// ✅ ĐÚNG (trong gateway controller)
throw new BadRequestException('Invalid request');
// Filter + Interceptor tự xử lý → HTTP 400, response envelope

// ❌ SAI
throw new Error('Server error'); // Plain Error (không qua filter)
```

### Per-Service Exception Filters
- Mỗi microservice nên kế thừa `AbstractRpcExceptionFilter` và override `getUniqueConstraintMessage()`:
  ```ts
  export class UserRpcExceptionFilter extends AbstractRpcExceptionFilter {
    getUniqueConstraintMessage(constraint: string): string {
      if (constraint === 'UQ_user_email') return 'Email already exists';
      return 'Unique constraint violation';
    }
  }
  ```

---

## 3. Configuration & Environment Variables

### Quy tắc
- **KHÔNG bao giờ sử dụng trực tiếp `process.env` trong logic code**
- **Bắt buộc dùng `ConfigService`** từ `@nestjs/config` (`ConfigModule.forRoot()` global)
- Toàn bộ env vars được **validate trong `CommonConfigModule`** (throw error nếu thiếu required vars)

### Required Environment Variables (từ libs/common)
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=...
DB_NAME=ecommerce

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_ACCESS_SECRET=your_secret
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_SECRET=your_refresh_secret
JWT_REFRESH_EXPIRATION=7d

# Gateway
API_KEY=your_api_key
CORS_ORIGINS=http://localhost:3000
PORT=3000

# (Other services have similar PORT, plus domain-specific vars like PAYMENT_PROVIDER, MINIO_HOST, etc.)
```

### Ví dụ
```ts
// ✅ ĐÚNG
constructor(private configService: ConfigService) {}

getDbHost(): string {
  return this.configService.get('DB_HOST'); // Type-safe if using @nestjs/config typing
}

// ❌ SAI
const dbHost = process.env.DB_HOST; // Direct process.env access
```

---

## 4. CQRS Pattern (Command Query Responsibility Segregation)

### Bắt buộc cho Services
- **Orders, Product, Payment, Review, Promotion services** PHẢI sử dụng `@nestjs/cqrs`
- **User, Notification services** không bắt buộc CQRS (intentionally simpler)

### Folder Structure Yêu cầu (cho CQRS services)
```
src/
├── commands/              # Lệnh thay đổi state
│   ├── create-order.command.ts
│   └── handlers/
│       └── create-order.handler.ts
├── queries/              # Lệnh đọc state
│   ├── get-order.query.ts
│   └── handlers/
│       └── get-order.handler.ts
├── events/              # Events (sau khi command succeed)
│   ├── order-created.event.ts
│   └── handlers/
│       └── order-created.event-handler.ts
├── controllers/         # Endpoints nhận request
├── services/            # Business logic (nếu không fit vào handler)
└── entities/            # TypeORM entities
```

### Command/Query/Event Definition
```ts
// ✅ ĐÚNG Command
export class CreateOrderCommand {
  constructor(
    public readonly userId: string,
    public readonly items: OrderItemInput[],
  ) {}
}

// ✅ ĐÚNG Handler (ví dụ minh hoạ; handler thật: apps/orders/src/commands/handlers/checkout.handler.ts)
@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  async execute(command: CreateOrderCommand): Promise<Order> {
    // 1. Validate
    // 2. Business logic
    // 3. Persist
    // 4. Publish events
    return order;
  }
}

// ✅ ĐÚNG Query
export class GetOrderQuery {
  constructor(public readonly orderId: string) {}
}

// ✅ ĐÚNG Event
export class OrderCreatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
  ) {}
}
```

### Controller Usage
```ts
@Controller('orders')
export class OrderController {
  constructor(private commandBus: CommandBus, private queryBus: QueryBus) {}

  @Post()
  async create(@Body() dto: CreateOrderDto) {
    const order = await this.commandBus.execute(
      new CreateOrderCommand(dto.userId, dto.items),
    );
    return order;
  }

  @Get(':id')
  async getOrder(@Param('id') orderId: string) {
    return await this.queryBus.execute(new GetOrderQuery(orderId));
  }
}
```

---

## 5. Database & TypeORM Conventions

### Naming
- **Table names**: snake_case, plural (e.g., `products`, `user_addresses`, `order_items`)
- **Column names**: snake_case (e.g., `user_id`, `created_at`, `is_active`)
- **Entity class names**: PascalCase (e.g., `User`, `Product`, `OrderItem`)

### Entity Standards
```ts
// ✅ ĐÚNG
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false })
  price: number;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @VersionColumn() // Optimistic lock
  version: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn() // Soft delete
  deleted_at: Date;

  @ManyToOne(() => Category, (cat) => cat.products)
  @JoinColumn({ name: 'category_id' })
  category: Category;
}
```

### Soft Delete
- Sử dụng `@DeleteDateColumn()` + `@DeleteDateColumn()` decorator
- Query mặc định auto-exclude deleted rows (TypeORM behavior)
- Khi cần lấy deleted rows: `.withDeleted()` trong query

### Locking
- **Optimistic Lock** (@VersionColumn): dùng cho high-read, low-write scenario (e.g., Product stock)
  - Retry logic trong handler khi version mismatch
- **Pessimistic Lock** (queryBuilder `.useSelectedLocks(true)`, `.setLock('pessimistic_write')`): dùng cho critical writes (e.g., Promotion voucher apply)

---

## 6. Communication Pattern (TCP/Message Pattern)

### Message Pattern Definition
- Tất cả inter-microservice communication patterns định nghĩa trong `libs/constant/message-pattern.constant.ts`
- Mỗi domain có 1 object riêng, key KHÔNG có prefix domain, giá trị là chuỗi snake_case (không dùng dot-notation)

```ts
// libs/constant/message-pattern.constant.ts (đúng như code thật)
export const ORDER_MESSAGE_PATTERN = {
  CREATE_ORDER: 'create_order',
  GET_ORDER: 'get_order',
  GET_ORDERS: 'get_orders',
  UPDATE_ORDER_STATUS: 'update_order_status',
  CREATE_REFUND: 'create_refund',
  APPROVE_REFUND: 'approve_refund',
  REJECT_REFUND: 'reject_refund',
  GET_REFUNDS: 'get_refunds',
};
```

> **Lưu ý phân biệt**: dot-notation (vd: `'order.created'`) chỉ dùng cho **outbox event type** (`ORDER_EVENT_TYPE` trong `apps/orders/src/events/order-event-type.constant.ts`), không phải RPC message pattern. Hai hệ thống hằng số này phục vụ 2 mục đích khác nhau: message pattern dùng cho request/response qua `@MessagePattern`, event type dùng cho outbox fan-out qua `@EventPattern`.

### Gateway ClientsModule Registration
```ts
// gateway/src/shared-clients.module.ts
@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'ORDER_SERVICE',
        transport: Transport.TCP,
        options: { host: 'localhost', port: 3002 },
      },
      // ... other services
    ]),
  ],
  exports: [ClientsModule],
})
export class SharedClientsModule {}
```

### TCP Send vs Emit
```ts
// ✅ Request/Response (mong đợi giá trị trả về) — dùng object { cmd } + firstValueFrom, KHÔNG dùng .toPromise() (đã deprecated)
const order = await firstValueFrom(
  this.orderClient.send({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER }, { orderId }),
);

// ✅ Fire-and-Forget (không mong đợi phản hồi)
this.notificationClient.emit(ORDER_EVENT_TYPE.ORDER_CREATED, { orderId, userId });

// ❌ Emit rồi mong đợi response (race condition, timeout)
const result = await firstValueFrom(this.notificationClient.emit('order.created', {}));
```

### TCP Timeout & Resilience
- **Timeout mặc định qua `TcpResilienceService`**: 10 giây (const `TIMEOUT_MS = 10000` trong `apps/gateway/src/common/tcp-resilience.service.ts`) — áp dụng cho hầu hết các call từ Gateway sang microservice
- **Ngoại lệ**: `JwtAuthGuard` gọi `VERIFY_TOKEN` trực tiếp (không qua `TcpResilienceService`/circuit breaker), dùng RxJS `timeout(5000)` riêng — 5 giây chỉ áp dụng cho call verify token này, không phải default chung
- **Circuit Breaker**: Wrapped via opossum, nhưng **Opossum's `timeout` option bị tắt (`false`)** — timeout thực tế do RxJS `timeout()` operator bên ngoài xử lý, Opossum chỉ theo dõi error rate (50% ngưỡng mở breaker, 15s half-open reset)
- Timeout exception → handled by HttpExceptionFilter → 502 Bad Gateway for client

---

## 7. Naming Conventions

### Files
- **Controllers**: `*.controller.ts` (e.g., `product.controller.ts`)
- **Services**: `*.service.ts` (e.g., `product.service.ts`)
- **Commands/Queries/Events**: `kebab-case.command.ts`, `*.query.ts`, `*.event.ts`
- **Handlers**: `kebab-case.handler.ts` (e.g., `create-order.handler.ts`)
- **Entities**: `*.entity.ts` (e.g., `product.entity.ts`)
- **DTOs**: `*.dto.ts` or `*.input.ts` (e.g., `create-product.dto.ts`)
- **Modules**: `*.module.ts` (e.g., `product.module.ts`)

### Classes & Types
- **Classes**: PascalCase (e.g., `Product`, `CreateProductCommand`, `ProductService`)
- **Interfaces**: PascalCase (e.g., `IProductRepository`, `PaymentProvider`)
- **Enums**: PascalCase (e.g., `OrderStatus`, `PaymentMethod`)

### Variables & Functions
- **Variables**: camelCase (e.g., `productId`, `totalPrice`, `isActive`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_STOCK`, `DEFAULT_PAGE_SIZE`)
- **Functions**: camelCase (e.g., `getProduct()`, `calculateDiscount()`)

### Database
- **Table**: snake_case, plural (e.g., `products`, `user_addresses`)
- **Columns**: snake_case (e.g., `user_id`, `created_at`)
- **Foreign Keys**: `{table_singular}_id` (e.g., `user_id`, `order_id`)
- **Indexes**: `idx_{table}_{column}` (e.g., `idx_products_category_id`)
- **Unique Constraints**: `uq_{table}_{column}` (e.g., `uq_users_email`)

---

## 8. Security Best Practices

### Password Hashing
- **BẮT BUỘC bcrypt** cho password hashing (không bao giờ store plain password)
- ```ts
  import * as bcrypt from 'bcrypt';
  const hashedPassword = await bcrypt.hash(password, 10); // rounds: 10
  ```

### JWT Token Management
- **Access Token**: 15 phút (stateless, không lưu DB)
- **Refresh Token**: 7 ngày (lưu **Redis** với key: `refresh_token:{userId}:{sessionId}`)
- **Logout**: Delete refresh token key từ Redis

### API Security
- **API Key**: Enforce via `RequestTrackerMiddleware` (x-api-key header check)
- **CORS**: Configure via CORS_ORIGINS env (default: localhost:3000)
- **Helmet**: Enable by default (gateway/main.ts)
- **Rate Limiting**: Redis-backed, 100/min default, 5/min for login/register
- **Idempotency**: x-idempotency-key header (24h TTL in Redis, prevents duplicate operations)

### Payment Webhook Security
- **HMAC-SHA256 signature verification** (PAYMENT_WEBHOOK_SECRET env)
- Example (Payment service):
  ```ts
  const signature = crypto
    .createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  if (signature !== incomingSignature) throw new UnauthorizedException();
  ```

### Sensitive Data
- **Never log**: passwords, JWT tokens, API keys, credit card numbers
- **Always use environment variables** for secrets (never hardcode)
- **.env file gitignored** (never commit)

---

## 9. Permission Model (Bitmask RBAC) {#permission-model}

### Concept
- Permission là số nguyên dạng bitmask
- `Action` chiếm 4 bit thấp nhất (bit 0-3); `ModuleName` bắt đầu từ bit 4 trở lên — **cố ý không overlap** với `Action` để có thể OR trực tiếp 2 enum lại mà không cần shift
- Permission check: `(userPermissions & required) === required`

### Definition (libs/constant/permission.constant.ts) — đúng như code thật
```ts
export enum Action {
  NONE = 0,
  CREATE = 1 << 0,        // 1
  READ = 1 << 1,          // 2
  UPDATE = 1 << 2,        // 4
  DELETE = 1 << 3,        // 8
  ALL = ~(~0 << 4),       // 15 (= CREATE|READ|UPDATE|DELETE)
}

export enum ModuleName {
  USER = 1 << 4,          // 16
  PRODUCT = 1 << 5,       // 32
  ORDER = 1 << 6,         // 64
  CAMPAIGN = 1 << 7,      // 128
  PAYMENT = 1 << 8,       // 256
  REVIEW = 1 << 9,        // 512
  PROMOTION = 1 << 10,    // 1024
}

// Kết hợp bằng OR thường, KHÔNG shift thêm:
// quyền "đọc Product" = ModuleName.PRODUCT | Action.READ = 32 | 2 = 34
```

### Usage (Gateway) — thứ tự tham số là (module, action)
```ts
// @RequirePermission decorator — module trước, action sau (đúng theo require-permission.decorator.ts)
@Post('products')
@RequirePermission(ModuleName.PRODUCT, Action.CREATE)
createProduct(@Body() dto: CreateProductDto) {
  // Chỉ user có quyền PRODUCT.CREATE mới gọi được
}

// Decorator lưu metadata bằng OR thường: SetMetadata(PERMISSION_KEY, module | action)
// PermissionGuard check: (user.permissions & (module | action)) === (module | action)
```

---

## 10. Testing Standards

### Test File Location & Naming
- **Unit tests**: `{feature}.spec.ts` (same folder as source)
- **E2E tests**: `{feature}.e2e-spec.ts` (in `test/` folder)
- Example: `src/commands/handlers/create-order.handler.spec.ts`

### Coverage Target
- **Minimum 70% line coverage** for new code per phase
- Critical paths (Saga, Outbox, Payment): aim for 90%+

### Testing Patterns
```ts
describe('CreateOrderHandler', () => {
  let handler: CreateOrderHandler;
  let mockOrderRepository: jest.Mocked<OrderRepository>;

  beforeEach(async => {
    mockOrderRepository = createMockProxy<OrderRepository>();
    handler = new CreateOrderHandler(mockOrderRepository, ...);
  });

  it('should create order and publish event', async () => {
    // Arrange
    const command = new CreateOrderCommand(...);
    mockOrderRepository.create.mockResolvedValue(mockOrder);

    // Act
    const result = await handler.execute(command);

    // Assert
    expect(result.id).toBeDefined();
    expect(mockOrderRepository.create).toHaveBeenCalled();
  });

  it('should compensate on payment failure', async () => {
    // Simulate payment failure, verify stock release, etc.
  });
});
```

---

## 11. Logging Standards

### Use Logger Service
- **Inject `Logger` từ @nestjs/common`** (không dùng console.log)
- Logs automatically include timestamp, context name, level

```ts
// ✅ ĐÚNG
import { Logger } from '@nestjs/common';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  async getProduct(id: string) {
    this.logger.debug(`Fetching product ${id}`);
    try {
      const product = await this.repository.findOne(id);
      this.logger.log(`Product ${id} fetched successfully`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to fetch product ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}

// ❌ SAI
console.log('Fetching product'); // No context, no structured logging
```

---

## 12. Common Pitfalls & Anti-Patterns

### ❌ Anti-Pattern: Trusting Client-Supplied Price
```ts
// SAI: Using client's unitPrice without validation
const orderItem = new OrderItem({
  productId: dto.productId,
  unitPrice: dto.unitPrice, // Client could lie!
  quantity: dto.quantity,
});
```

**Fix**: Re-validate price from Product service:
```ts
const product = await this.productService.getProduct(dto.productId);
const orderItem = new OrderItem({
  productId: dto.productId,
  unitPrice: product.price, // Server-side canonical price
  quantity: dto.quantity,
});
```

### ❌ Anti-Pattern: No Idempotency on Critical Operations
```ts
// SAI: Payment charge without idempotency key
async chargePayment(orderId: string, amount: number) {
  return await this.paymentProvider.charge({ orderId, amount });
  // Retry → double-charge!
}
```

**Fix**: Idempotency key:
```ts
async chargePayment(orderId: string, amount: number) {
  return await this.paymentProvider.charge({
    orderId,
    amount,
    idempotencyKey: orderId, // Retry → same key → deduped
  });
}
```

### ❌ Anti-Pattern: Event Loss (No Outbox)
```ts
// SAI: Update DB then emit event separately (not transactional)
await this.orderRepository.save(order); // Success
await this.eventEmitter.emit('order.created', order); // Fails → event lost!
```

**Fix**: Transactional Outbox (style thật trong `apps/orders` — `dataSource.transaction()` + `OutboxWriter` của `@lib/messaging`, đổi trạng thái qua `OrderTransitionService`):
```ts
await this.dataSource.transaction(async (manager) => {
  await manager.insert(Order, order);
  await this.outbox.append(manager, {
    topic: KAFKA_TOPIC.ORDER_EVENTS,
    type: MESSAGE_TYPE.ORDER_CREATED,
    orderId: order.id, // partition key
    payload: { userId: order.userId, totalAmount: order.totalAmount, expiresAt },
  });
});
// Rollback tự động nếu callback throw. Sau đó OutboxRelayService đẩy Kafka (at-least-once); consumer dùng KafkaConsumerRunner (Inbox)
```

### ❌ Anti-Pattern: Race Condition on Stock
```ts
// SAI: Read stock, check, then write (not atomic)
const product = await this.repository.findOne(id);
if (product.stock < qty) throw new Error('Out of stock');
product.stock -= qty; // Race condition!
await this.repository.save(product);
```

**Fix**: Optimistic Locking:
```ts
// Use @VersionColumn + transaction + retry on version mismatch
const product = await this.repository.findOne(id);
product.stock -= qty;
try {
  await this.repository.save(product); // Fails if version changed
} catch (e) {
  if (e.code === 'VERSION_MISMATCH') {
    return this.adjustStock(id, qty); // Retry
  }
  throw e;
}
```

---

## 13. Dead Code & Cleanup Candidates

### Known Dead Code (flag for refactor)
1. **`libs/common/src/constant/cmd.ts`**: Stale duplicate of `libs/constant/message-pattern.constant.ts` — use latter
2. **amqp-connection-manager**, **amqplib** packages: In `package.json` but RabbitMQ fully deprecated — can remove

---

## 14. Checklists for Code Review

### Before Commit
- [ ] All DTOs use `class-validator` decorators
- [ ] No `process.env` directly accessed (use `ConfigService`)
- [ ] CQRS services have proper commands/queries/handlers structure
- [ ] Exceptions are `RpcException` or NestJS built-in (never plain `Error`)
- [ ] Sensitive data (passwords, secrets) are never logged
- [ ] Database writes use appropriate locking (optimistic/pessimistic)
- [ ] TCP calls have timeout & error handling
- [ ] Test coverage ≥70% for new code
- [ ] Naming conventions followed (snake_case DB, camelCase code, PascalCase classes)

### For Critical Paths (Saga, Payment, Outbox)
- [ ] Idempotency key implemented
- [ ] Compensation logic tested (failure scenarios)
- [ ] Transactional Outbox used (not separate event emit)
- [ ] E2E test covers happy path + failure path
- [ ] No lost event scenarios possible

---

## References
- Root `CLAUDE.md`: Project-level rules & architecture
- Per-app `CLAUDE.md`: Domain-specific patterns (e.g., `apps/gateway/CLAUDE.md`)
- `libs/constant/`: Message patterns, permissions, ports
- `libs/database/src/migrations/`: Schema changes (read to understand DB structure)
