# Code Standards & Conventions

**Ngày cập nhật**: 2026-10-15

Tài liệu này định nghĩa quy tắc lập trình và convention đang được áp dụng trong code (đã đối chiếu với `apps/*` và `libs/*` ngày 2026-10-15). Mỗi ví dụ là mẫu thật trong repo hoặc được ghi rõ là mẫu minh hoạ. Khi code và tài liệu lệch nhau, tin code và sửa tài liệu.

## 1. Validation (Kiểm tra Dữ liệu)

### Nguyên tắc
- **Mọi DTO dùng decorator class-validator** (`@IsString()`, `@IsUUID()`, `@IsOptional()`, `@ValidateNested()`...).
- **Gateway** đăng ký global `ValidationPipe` trong `apps/gateway/src/main.ts`:
  ```ts
  new ValidationPipe({
    whitelist: true,            // bỏ property không khai báo trong DTO
    forbidNonWhitelisted: true, // field lạ → 400
    transform: true,            // chuyển payload thành instance DTO
  })
  ```
- **Microservice Notification, Payment, Inventory, Shipping, Promotion** đăng ký `ValidationPipe({ whitelist: true, transform: true })` (không có `forbidNonWhitelisted`).
- **Orders không có ValidationPipe toàn cục** vì payload đến qua TCP. Orders tự kiểm tra ở biên handler bằng `parseDto` (`apps/orders/src/dto/parse-dto.ts`: `plainToInstance` + `validateSync` với `whitelist`, lỗi gom thành `RpcException` 400).
- Không kiểm tra null/undefined thủ công ở controller nếu DTO đã khai báo rule.

### Ví dụ
```ts
// ✅ Đúng — apps/orders/src/dto/checkout.dto.ts (rút gọn)
export class CheckoutItemDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;
}

export class CheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  items: CheckoutItemDto[];

  @IsDefined()
  shippingAddress: ShippingAddressDto;

  @IsOptional()
  @IsString()
  voucherCode?: string;
}

// ❌ Sai — DTO không có decorator, ValidationPipe không kiểm được gì
export class CheckoutDto {
  items: CheckoutItemDto[];
}
```

---

## 2. Error Handling (Xử lý Ngoại lệ)

### Trong microservice
- Ném **`RpcException({ statusCode, message })`** cho lỗi nghiệp vụ, hoặc exception chuẩn của Nest (`BadRequestException`, `NotFoundException`...).
- Không ném `Error` thô hoặc chuỗi. Lỗi không phải `RpcException` sẽ thành 500 ở Gateway.

```ts
// ✅ Đúng — apps/orders/src/order-state/order-transition.service.ts
if (!canTransition(from, to)) {
  throw new RpcException({
    statusCode: 400,
    message: `Không thể chuyển trạng thái từ ${from} sang ${to}`,
  });
}

// ✅ Đúng — lỗi lệch version là lớp con của RpcException (409)
export class OrderVersionConflictError extends RpcException {
  constructor(readonly orderId: string) {
    super({ statusCode: 409, message: 'Đơn vừa thay đổi, hãy tải lại' });
  }
}

// ❌ Sai
throw new Error('Something went wrong');
throw 'Invalid input';
```

- Mỗi service có một `RpcExceptionFilter` kế thừa `AbstractRpcExceptionFilter` (`libs/common/src/filters/base-rpc-exception.filter.ts`). Filter này đã xử lý `RpcException`, `HttpException`, lỗi TypeORM (unique constraint) và lỗi validation, rồi trả về dạng RPC-safe. Subclass chỉ cần cài đặt `getUniqueConstraintMessage`:
  ```ts
  // apps/user/src/filters/rpc-exception.filter.ts
  export class UserRpcExceptionFilter extends AbstractRpcExceptionFilter {
    protected getUniqueConstraintMessage(message: string): string {
      if (message.includes('email')) return 'User with this email already exists';
      return 'Duplicate entry found';
    }
  }
  ```
- Các filter hiện có: `User`, `Payment`, `Notification`, `Inventory`, `Shipping`, `Promotion`, `Review` (`apps/<service>/src/filters/rpc-exception.filter.ts`).

### Trong Gateway
- `HttpExceptionFilter` (`apps/gateway/src/common/fliters/http-exception.filter.ts`, tên thư mục viết `fliters` là có thật, giữ nguyên khi import) chuyển lỗi về HTTP status và envelope lỗi.
- `MicroserviceErrorHandler.handleError(...)` (`apps/gateway/src/common/microservice-error.handler.ts`) lấy HTTP status theo thứ tự: `statusCode` → `status` → `name` → chuỗi message → mặc định 502. Timeout trả 408.
- Gateway không ném `Error` thô. Dùng exception của Nest (`BadRequestException`...) hoặc để `MicroserviceErrorHandler` chuyển lỗi từ service.

---

## 3. Configuration & Environment Variables

### Quy tắc
- **Logic nghiệp vụ không đọc `process.env` trực tiếp.** Dùng `ConfigService` (`ConfigModule` global từ `CommonConfigModule`).
- Ngoại lệ có chủ đích, chỉ ở tầng không chạy trong app: `libs/database/src/data-source.ts` (TypeORM CLI, `migration:*`) và helper test `libs/database/test/integration-data-source.ts`.
- `CommonConfigModule` gọi `validateEnv` (`libs/common/src/utils/env-validation.ts`). Thiếu biến bắt buộc thì **mọi** service không khởi động.

### Biến bắt buộc (`validateEnv`)
```env
DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
REDIS_HOST REDIS_PORT
JWT_ACCESS_SECRET JWT_ACCESS_EXPIRATION JWT_REFRESH_SECRET JWT_REFRESH_EXPIRATION
API_KEY
KAFKA_BROKERS=localhost:9092
PAYMENT_WEBHOOK_SECRET
SHIPPING_WEBHOOK_SECRET
```
Biến tuỳ chọn có validate và giá trị mặc định nằm trong code (xem [onboarding-guide.md](./onboarding-guide.md) §5 và [README](../README.md) mục 2b).

### Ví dụ
```ts
// ✅ Đúng — đọc qua ConfigService, có giá trị mặc định
const ttl = this.config.get<number>('CART_TTL_SECONDS') ?? 2592000;
const secret = this.configService.getOrThrow<string>('PAYMENT_WEBHOOK_SECRET');

// ❌ Sai trong logic nghiệp vụ
const secret = process.env.PAYMENT_WEBHOOK_SECRET;
```

---

## 4. CQRS Pattern (Command Query Responsibility Segregation) {#cqrs-structure}

### Service nào dùng CQRS
- **Bắt buộc** (`@nestjs/cqrs`): Product, Orders, Payment, Review, Promotion, Inventory, Shipping.
- **Không dùng**: User, Notification (controller/service trực tiếp, chủ ý vì nghiệp vụ nhỏ).

### Cấu trúc thư mục
```
src/
├── commands/                 # thay đổi state
│   ├── checkout.command.ts
│   └── handlers/
│       └── checkout.handler.ts
├── queries/                  # đọc state
│   ├── get-order.query.ts
│   └── handlers/get-order.handler.ts
├── events/                   # event nội bộ của một service (dùng EventBus)
│   ├── product-created.event.ts
│   └── handlers/
├── messaging/                # consumer Kafka: controller mỏng → CommandBus (Orders, Promotion...)
├── order-state/ · pricing/ · cart/ ...   # module con theo domain
└── entities/                 # TypeORM entities
```
`events/` chỉ có ở Product (`ProductCreatedEvent`). Orders dùng `messaging/` và `jobs/` thay cho `events/`. Các thư mục là quy ước theo domain, không bắt buộc đủ tất cả.

### Command / Query / Handler (mẫu thật)
```ts
// apps/orders/src/commands/checkout.command.ts
export class CheckoutCommand {
  constructor(
    /** Lấy từ token do Gateway gắn, không từ body. */
    public readonly userId: string,
    public readonly dto: CheckoutDto,
  ) {}
}

// apps/orders/src/commands/handlers/checkout.handler.ts (rút gọn)
@CommandHandler(CheckoutCommand)
export class CheckoutHandler implements ICommandHandler<CheckoutCommand> {
  async execute(command: CheckoutCommand): Promise<CheckoutResult> {
    // 1. Pricing server-side (giá từ Product, số lượng từ cart, voucher)
    // 2. Inventory.RESERVE (TCP) → 3. Promotion.RESERVE_VOUCHER
    // 4. Transaction: insert Order PENDING_PAYMENT + OutboxWriter.append
    // 5. Chốt #1 CHECK_RESERVATION → 6. Payment.CREATE_INTENT
    return { orderId, status: OrderStatus.PENDING_PAYMENT, payment_url, expiresAt };
  }
}
```

### Controller dùng CommandBus / QueryBus (mẫu thật)
```ts
// apps/orders/src/orders.controller.ts (rút gọn)
@Controller()
export class OrdersController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}

  @MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.CHECKOUT }, Transport.TCP)
  async checkout(@Payload() payload: { userId: string; dto: CheckoutDto }) {
    return this.commandBus.execute(new CheckoutCommand(payload.userId, payload.dto));
  }

  @MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER }, Transport.TCP)
  async getOrder(@Payload() data: { id: string }) {
    return this.queryBus.execute(new GetOrderQuery(data.id));
  }
}
```

### Event nội bộ
- `EventBus` của `@nestjs/cqrs` chỉ dùng **trong một service** (vd `ProductCreatedEvent` hiện chỉ `console.log`).
- Event **giữa service** không đi qua `EventBus`. Đi qua Outbox → Kafka (mục 6).

---

## 5. Database & TypeORM Conventions

### Naming
- **Tên bảng**: snake_case, số nhiều (`orders`, `order_items`, `stock_items`, `reservations`, `voucher_redemptions`, `processed_messages`, `outbox`).
- **Tên cột**: theo **tên property** trong entity (camelCase), vì không có `NamingStrategy`. Ví dụ `userId`, `expiresAt`, `onHand`, `eventId`. Cột khoá ngoại dùng `@JoinColumn({ name: 'order_id' })` (snake_case).
- **Tên class entity**: PascalCase (`Order`, `OrderItem`, `StockItem`).
- **Chỉ mục / ràng buộc** trong các migration và entity mới: `IDX_{table}_{cols}`, `UQ_{table}_{col}` (ví dụ `IDX_orders_status_expires`, `UQ_outbox_eventId`). Bảng cũ có tên do TypeORM sinh.

### Entity (mẫu thật)
```ts
// apps/orders/src/entities/order.entity.ts (rút gọn)
@Entity('orders')
@Index('IDX_orders_status_expires', ['status', 'expiresAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING_PAYMENT })
  status: OrderStatus;

  // Khoá lạc quan: mọi đổi state phải UPDATE ... WHERE version = :v (xem OrderTransitionService)
  @Column({ type: 'int', default: 1 })
  version: number;

  @DeleteDateColumn()
  deletedAt: Date;
}
```

### Soft delete
- `@DeleteDateColumn()` có ở `User`, `Product`, `ProductVariant`, `Order`.
- Thực tế: Product và Brand/Attribute bị xoá cứng (`remove`); Variant dùng `softRemove`. Nên ghi rõ trong code khi chọn cách xoá.

### Locking
| Cơ chế | Dùng ở đâu | Cách viết |
|---|---|---|
| Optimistic (cột `version`) | Order | `UPDATE orders SET ..., version = version + 1 WHERE id = :id AND version = :v`, 0 dòng → `OrderVersionConflictError` (`OrderTransitionService`). Không dùng `save()` để đổi trạng thái. |
| Optimistic (`@VersionColumn`) | Product, ProductVariant | Cột có sẵn, nhưng không còn dùng để trừ kho. |
| Pessimistic (`pessimistic_write`) | Promotion (voucher), Shipping (`CancelShipment`) | `findOne(Entity, { where, lock: { mode: 'pessimistic_write' } })` trong transaction. |
| Khoá theo thứ tự id | Inventory (`stock_items`) | Một câu `SELECT ... ORDER BY id FOR UPDATE` cho mọi dòng sẽ ghi, tránh deadlock. |

---

## 6. Communication Pattern (TCP + Kafka)

Có hai kênh, chọn theo bản chất:

| Kênh | Dùng cho | Ví dụ |
|---|---|---|
| **TCP** `{cmd}` (request/response) | Cần trả lời ngay | Gateway → Orders `checkout_order`; Orders → Inventory `inventory_reserve`; Orders → Product `get_product` |
| **Kafka** (at-least-once, Outbox + Inbox) | Event/command sau một điểm quyết định | `OrderPaid`, `CommitInventory`, `CreateShipment`, `ShipmentDelivered`... |

### 6.1 Message pattern TCP
- Định nghĩa trong `libs/constant/message-pattern.constant.ts`, mỗi domain một object, **key không có prefix domain**, giá trị snake_case không có dấu chấm.
  ```ts
  export const ORDER_MESSAGE_PATTERN = {
    GET_ORDERS: 'get_orders',
    GET_ORDER: 'get_order',
    CHECKOUT: 'checkout_order',
    GET_PAYMENT_LINK: 'get_order_payment_link',
    CANCEL_ORDER: 'cancel_order',
    REQUEST_RETURN: 'request_order_return',
    GET_REFUNDS: 'get_refunds',
  };
  ```
- Gọi qua `ClientProxy.send({ cmd }, payload)` đi qua `TcpResilienceService` (mục 6.3), không gọi `client.send` trần ở Gateway.
- **Hybrid app** (TCP + Kafka trong cùng process): **mọi** `@MessagePattern` gắn `Transport.TCP`, mọi `@EventPattern` gắn `Transport.KAFKA`. Thiếu tham số này thì pattern bị đăng ký cho cả hai transport và `{cmd: ...}` bị hiểu thành tên topic (đã gặp ở Notification, sửa trong e2e).
  ```ts
  @MessagePattern({ cmd: INVENTORY_MESSAGE_PATTERN.RESERVE }, Transport.TCP)
  @EventPattern(KAFKA_TOPIC.PAYMENT_EVENTS, Transport.KAFKA)
  ```

### 6.2 Gateway ClientsModule (mẫu thật)
```ts
// apps/gateway/src/shared-clients.module.ts (rút gọn)
@Global()
@Module({
  imports: [
    ClientsModule.register([
      { name: NAME_SERVICE_TCP.ORDER_SERVICE, transport: Transport.TCP,
        options: { host: 'localhost', port: PORT_TCP.ORDER_TCP_PORT } },
      // USER, PRODUCT, PAYMENT, NOTIFICATION, REVIEW, PROMOTION, INVENTORY, SHIPPING
    ]),
  ],
  exports: [ClientsModule],
})
export class SharedClientsModule {}
```
Host đang hardcode `localhost` (xem [design-trade-offs.md §1.5](./design-trade-offs.md)).

### 6.3 Gọi TCP có timeout và circuit breaker
```ts
// Gateway: qua TcpResilienceService, rồi map lỗi
try {
  return await this.tcpResilience.send(
    NAME_SERVICE_TCP.ORDER_SERVICE, this.orderClient,
    { cmd: ORDER_MESSAGE_PATTERN.CHECKOUT }, { userId, dto },
  );
} catch (error) {
  MicroserviceErrorHandler.handleError(error, 'checkout', 'Order service');
}
```
- **Timeout mặc định 10 giây** (`DEFAULT_TCP_TIMEOUT_MS` trong `apps/gateway/src/common/tcp-resilience.service.ts`). Có thể truyền `timeoutMs` riêng: catalog ghép tồn kho dùng `INVENTORY_LOOKUP_TIMEOUT_MS = 1500`.
- **Ngoại lệ**: `JwtAuthGuard` gọi `VERIFY_TOKEN` trực tiếp, không qua breaker, `timeout(5000)`.
- **Circuit breaker** (opossum, một breaker cho mỗi `serviceKey`): `timeout: false` (timeout do RxJS `timeout()` xử lý), mở khi >50% lỗi trong cửa sổ 10 giây, half-open sau 15 giây.
- **Lỗi 4xx không tính là lỗi hạ tầng** (`errorFilter: isClientError`). Vài request sai từ client không làm mở breaker.
- Service → service (Orders → Inventory/Payment/Product/Promotion, Review → Orders, Notification → User) chỉ có `timeout()` 10 giây, **không** có breaker hay retry.

### 6.4 Event qua Outbox và Kafka
- **Quy tắc**: mọi event/command ra ngoài ghi bằng `OutboxWriter.append(manager, ...)` **trong cùng transaction** với đổi state. Không `emit` trực tiếp, không `EventBus` cho liên-service.
- **Event type** là **PascalCase** và khai báo tập trung ở `MESSAGE_TYPE` (`libs/constant/kafka.constant.ts`): `OrderCreated`, `OrderStatusChanged`, `OrderPaid`, `OrderCancelled`, `CommitInventory`, `PaymentSucceeded`, `ShipmentDelivered`... Không dùng dot-notation (`order.created`) cho event type.
- **Topic** (kebab-case, khai báo ở `KAFKA_TOPIC`): `order-events`, `payment-events`, `payment-commands`, `inventory-commands`, `inventory-events`, `shipping-commands`, `shipping-events`. DLQ là `<topic>.dlq` (`dlqTopic()`).
- **Consumer group** = tên service (`CONSUMER_GROUP`: `orders-service`, `payment-service`...) và là khoá `consumer` của bảng `processed_messages`.
- **Partition key** = `orderId` để giữ thứ tự theo đơn.
- **Envelope** (`libs/messaging/src/envelope.ts`): `{ eventId, type, orderId, occurredAt, version, payload }`. Command và event cùng envelope, phân biệt bằng `type` và topic.

```ts
// Ghi outbox trong cùng transaction với đổi state (mẫu: OrderTransitionService)
await this.outboxWriter.append(manager, {
  topic: KAFKA_TOPIC.ORDER_EVENTS,
  type: MESSAGE_TYPE.ORDER_STATUS_CHANGED,
  orderId: order.id, // partition key
  payload: { userId: order.userId, previousStatus: from, status: to },
});
```

```ts
// Consumer: controller mỏng → CommandBus → handler dùng KafkaConsumerRunner
// apps/orders/src/messaging/payment-events.consumer.ts
@Controller()
export class PaymentEventsConsumer {
  constructor(private readonly commandBus: CommandBus) {}

  @EventPattern(KAFKA_TOPIC.PAYMENT_EVENTS, Transport.KAFKA)
  async handle(@Payload() message: unknown): Promise<void> {
    await this.commandBus.execute(
      new HandlePaymentEventCommand(message, KAFKA_TOPIC.PAYMENT_EVENTS),
    );
  }
}

// apps/orders/src/commands/handlers/handle-payment-event.handler.ts (rút gọn)
execute(command: HandlePaymentEventCommand): Promise<void> {
  return this.runner.run({
    consumer: CONSUMER_GROUP.ORDERS,
    topic: command.topic,
    message: command.message,
    handle: (manager, envelope) => this.dispatch(manager, envelope),
  });
}
```

### 6.5 KafkaConsumerRunner: Inbox, retry, DLQ
`KafkaConsumerRunner.run({ consumer, topic, message, handle, onExhausted })` (`libs/messaging/src/consumer/kafka-consumer.runner.ts`):
1. Envelope sai → gửi thẳng `<topic>.dlq`.
2. Mở **một transaction**: `INSERT INTO processed_messages (consumer, eventId) ON CONFLICT DO NOTHING`. Trùng thì bỏ qua. Sau đó gọi `handle(manager, envelope)`, là nơi đổi state và ghi outbox.
3. Lỗi → rollback (Inbox cũng rollback) → retry tối đa `KAFKA_CONSUMER_MAX_ATTEMPTS` (mặc định 3) với backoff `KAFKA_CONSUMER_RETRY_BACKOFF_MS` (mặc định 200ms × số lần).
4. Hết lượt → `<topic>.dlq` → `onExhausted` (vd Shipping phát `ShipmentFailed`, Payment phát `PaymentRefundFailed`).
5. `HandleResult.afterCommit` chạy sau khi commit; lỗi chỉ được log (vd trừ giỏ Redis).

Runner chỉ `throw` khi không đảm bảo được message đã được lưu ở đâu (DLQ hoặc `onExhausted` lỗi), để Kafka giao lại thay vì mất message.

### 6.6 Outbox relay và producer
- `OutboxRelayService` (mỗi service chỉ relay row có `source` của mình): `SELECT ... FOR UPDATE OF o SKIP LOCKED`, giữ thứ tự theo `key` (row sau không vượt row PENDING trước cùng key), gửi tuần tự.
- **Chỉ đánh dấu `PUBLISHED` sau khi broker ack** (`acks: -1`, `idempotent: true`, `maxInFlightRequests: 1`). Lỗi → tăng `retryCount` và backoff; quá `OUTBOX_MAX_RETRY` (mặc định 10) → `FAILED` + metric `outbox_failed_total`.
- Tham số: `OUTBOX_RELAY_INTERVAL_MS` (mặc định 1000).
- Broker tắt auto-create topic: `main.ts` của service hybrid gọi `ensureKafkaTopics(brokers, partitions)` trước `startAllMicroservices()`.

### 6.7 main.ts của service hybrid (mẫu thật, rút gọn)
```ts
await ensureKafkaTopics(kafkaBrokers(config), config.get<number>('KAFKA_TOPIC_PARTITIONS', 3));
app.connectMicroservice<MicroserviceOptions>(
  { transport: Transport.TCP, options: { host: 'localhost', port: PORT_TCP.ORDER_TCP_PORT } },
  { inheritAppConfig: true },
);
app.connectMicroservice<MicroserviceOptions>(
  buildKafkaServerOptions(config, CONSUMER_GROUP.ORDERS), // postfixId '' giữ đúng tên group
  { inheritAppConfig: true },
);
app.enableShutdownHooks();
await app.startAllMicroservices();
await app.init();
```

### 6.8 Consumer `fromBeginning: false` (cảnh báo)
`buildKafkaServerOptions` đặt `subscribe: { fromBeginning: false }`. Một message phát khi consumer đang down có thể bị bỏ qua nếu partition đó chưa có offset đã commit của group. Đây là lỗi đã tái hiện ở e2e (F1, xem [design-trade-offs.md §2.4](./design-trade-offs.md#24-transactional-outbox--inbox-qua-kafka-at-least-once)). Khi thêm consumer mới, khởi động consumer trước khi producer phát event đầu tiên.

---

## 7. Naming Conventions

### Files
- **Controllers**: `*.controller.ts`. **Services**: `*.service.ts`. **Modules**: `*.module.ts`.
- **Commands / Queries / Events**: `kebab-case.command.ts`, `*.query.ts`, `*.event.ts`.
- **Handlers**: `kebab-case.handler.ts` (ví dụ `checkout.handler.ts`).
- **Entities**: `*.entity.ts`. **DTOs**: `*.dto.ts`.
- **Consumer Kafka**: `*.consumer.ts` (`payment-events.consumer.ts`). **Job/scheduler**: `*.scheduler.ts`, `*.job.ts`.
- **Test**: `{feature}.spec.ts` (unit, cạnh source), `*.int-spec.ts` (integration, thư mục `test/`), `*.e2e-spec.ts` (thư mục `test/`).

### Classes & Types
- **Class, interface, enum**: PascalCase (`Order`, `CheckoutCommand`, `OrderStatus`, `PaymentProvider`).
- **Enum values**: UPPER_SNAKE (`PENDING_PAYMENT`, `RESERVED`).

### Variables & Functions
- **Biến, hàm**: camelCase (`productId`, `getStockInfo()`).
- **Hằng số**: UPPER_SNAKE (`DEFAULT_TCP_TIMEOUT_MS`, `KAFKA_TOPIC`).

### Message identifiers
- **TCP pattern** (`*_MESSAGE_PATTERN`): snake_case không có dấu chấm (`checkout_order`, `inventory_reserve`).
- **Kafka event/command type** (`MESSAGE_TYPE`): PascalCase (`OrderCreated`).
- **Kafka topic, consumer group**: kebab-case (`order-events`, `orders-service`).

---

## 8. Security Best Practices

### Password hashing
- **Bắt buộc bcrypt** (`bcrypt.hash(password, 10)`). Không lưu mật khẩu dạng rõ.

### JWT & session
- **Access token**: 15 phút (`JWT_ACCESS_EXPIRATION`), không lưu DB. Ký bằng `JWT_ACCESS_SECRET`.
- **Refresh token**: 7 ngày, lưu Redis với key `refresh_token:{userId}:{sessionId}`. TTL **cố định 7 ngày** trong code (`SEVEN_DAYS_IN_SECONDS`), không theo `JWT_REFRESH_EXPIRATION`.
- **Verify mỗi request**: Gateway gọi `User.VERIFY_TOKEN` (qua TCP). User kiểm tra chữ ký, session trong Redis còn tồn tại, user `isActive`, rồi tính permissions.
- **Logout**: xoá key Redis (`DEL refresh_token:{userId}:{sessionId}`). Access token mất hiệu lực ngay ở request kế tiếp.
- **Chưa có** endpoint refresh token. Access token hết hạn thì phải login lại.
- **Cảnh báo**: `POST /user/logout` hiện không có guard và nhận `userId`/`sessionId` từ body (xem [design-trade-offs.md R4](./design-trade-offs.md)). Không dùng làm mẫu.

### API key & idempotency (Gateway)
- Mọi route **bắt buộc** header `x-api-key` == `API_KEY`, kể cả `/webhooks/*`. Miễn: `/health` và `/simulator/*` (`API_KEY_EXEMPT_ROUTES`).
- `x-idempotency-key`: **bắt buộc** cho `POST /cart/checkout` (`@RequireIdempotencyKey()`, thiếu → 400, Redis lỗi → 503). Các route ghi khác: tuỳ chọn, Redis lỗi thì chạy tiếp (fail-open).
- Key khớp `^[A-Za-z0-9._:-]{1,128}$`. Redis key scope theo `userId + method + path`. Marker `processing` TTL 120 giây, kết quả TTL 24 giờ.
- Còn hở: get-rồi-set không nguyên tử (chưa có `SET NX` trong `libs/cached`).

### Webhook HMAC (mẫu thật)
Webhook Payment và Shipping đều ký **HMAC-SHA256** trên `JSON.stringify(payload)` và so sánh bằng `timingSafeEqual`. Chữ ký nằm trong body `{ payload, signature }`:
```ts
// apps/payment/src/providers/simulated-payment.provider.ts (rút gọn)
signWebhook(payload: Record<string, unknown>): string {
  return createHmac('sha256', this.secret()).update(JSON.stringify(payload)).digest('hex');
}

verifyWebhook(payload, signature: string): WebhookVerifyResult {
  if (typeof signature !== 'string') return { valid: false };
  const expected = Buffer.from(this.signWebhook(payload));
  const actual = Buffer.from(signature);
  // timingSafeEqual ném lỗi khi độ dài khác nhau nên kiểm tra trước
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { valid: false };
  }
  return { valid: true, eventId: payload.eventId as string, orderId: payload.orderId as string };
}

private secret(): string {
  return this.configService.getOrThrow<string>('PAYMENT_WEBHOOK_SECRET');
}
```
- Secret là bắt buộc (`getOrThrow` và `validateEnv`), không có fallback.
- Provider thật phải ký **raw body**. Chữ ký trên `JSON.stringify` phụ thuộc thứ tự key (xem [design-trade-offs.md §4](./design-trade-offs.md)).

### Sensitive data
- **Không log**: mật khẩu, JWT, API key, số thẻ, secret webhook.
- **Secret** luôn lấy từ env, không hardcode. File `.env` nằm trong `.gitignore`.

---

## 9. Permission Model (Bitmask RBAC) {#permission-model}

### Concept
- Quyền là số nguyên bitmask. `Action` chiếm bit 0–3, `ModuleName` bắt đầu từ bit 4. Hai enum không chồng bit nên có thể OR trực tiếp.
- Kiểm tra: `(userPermissions & required) === required` (phải đủ mọi bit).
- Quyền của user = OR mọi Role được gán. Không có role thì dùng cột `User.permissions` (mặc định 0).

### Definition (`libs/constant/permission.constant.ts`)
```ts
export enum Action {
  NONE = 0,
  CREATE = 1 << 0,   // 1
  READ = 1 << 1,     // 2
  UPDATE = 1 << 2,   // 4
  DELETE = 1 << 3,   // 8
  ALL = ~(~0 << 4),  // 15
}

export enum ModuleName {
  USER = 1 << 4,       // 16
  PRODUCT = 1 << 5,    // 32
  ORDER = 1 << 6,      // 64
  CAMPAIGN = 1 << 7,   // 128 (chưa dùng)
  PAYMENT = 1 << 8,    // 256
  REVIEW = 1 << 9,     // 512
  PROMOTION = 1 << 10, // 1024
}
```
Không có module riêng cho Inventory hay Shipping: `/shipments/*` dùng `ModuleName.ORDER`, còn điều chỉnh tồn kho `POST /products/:id/stock-adjustments` dùng `ModuleName.PRODUCT` + `Action.UPDATE`.

### Usage (Gateway)
```ts
// apps/gateway/src/product/product.controller.ts (rút gọn)
// @RequirePermission(module, action): module trước, action sau
@Controller('products')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProductController {
  @Post()
  @RequirePermission(ModuleName.PRODUCT, Action.CREATE)
  createProduct(@Body() dto: CreateProductDto) { /* ... */ }
}
```
- Bitmask chỉ kiểm tra **module + action**, không kiểm tra **chủ sở hữu**. Route theo người dùng phải lấy `userId` từ token (`@GetUser('userId')`) và để service kiểm tra. Đây là nguyên nhân các gap R2/R3 trong [design-trade-offs.md §5](./design-trade-offs.md).

---

## 10. Testing Standards

### 10.1 Loại test và vị trí
| Loại | File | Lệnh | Cần gì |
|---|---|---|---|
| Unit (mock) | `src/**/*.spec.ts`, cạnh source | `npm test` (jest, `roots: apps, libs`) | Không cần hạ tầng |
| Integration | `apps/*/test/*.int-spec.ts`, `libs/messaging/test/*.int-spec.ts` | `npm run test:int` (`jest.integration.json`, `--runInBand`) | Postgres; Kafka khi `INT_KAFKA=1` |
| E2E (HTTP) | `apps/gateway/test/app.e2e-spec.ts` | jest với `apps/gateway/test/jest-e2e.json` | Chưa có bộ E2E tự động cho checkout |

- Script `npm run test:e2e` trỏ tới `./apps/ecommerce-system/test/jest-e2e.json`, file này **không tồn tại**. Không dùng script này cho đến khi sửa.
- E2E checkout hiện chạy **thủ công** theo runbook E-01…E-14 ([test-cases.md](../plans/261015-1700-checkout-v2-event-driven/test-cases.md)); kết quả ở `plans/261015-1700-checkout-v2-event-driven/reports/e2e-test-report.md`.

### 10.2 Unit test (mẫu thật)
```ts
// apps/orders/src/order-state/order-transition.service.spec.ts (rút gọn)
function setup(affected: number) {
  const update = jest.fn().mockResolvedValue({ affected });
  const append = jest.fn().mockResolvedValue('evt');
  const manager = { update } as unknown as EntityManager;
  const service = new OrderTransitionService({ append } as unknown as OutboxWriter);
  return { service, manager, update, append };
}

describe('OrderTransitionService', () => {
  it('affected 1: UPDATE theo version, outbox OrderStatusChanged, version+1', async () => {
    const { service, manager, update, append } = setup(1);
    const order = { id: 'o-1', userId: 'u-1', status: OrderStatus.PENDING_PAYMENT, version: 3 } as Order;

    await service.transition(manager, { order, to: OrderStatus.PAID });

    expect(update).toHaveBeenCalledWith(Order, { id: 'o-1', version: 3 }, expect.anything());
    expect(append).toHaveBeenCalledWith(manager, expect.objectContaining({
      type: MESSAGE_TYPE.ORDER_STATUS_CHANGED,
    }));
  });
});
```
- Mock bằng `jest.fn()` và ép `as unknown as <Type>`. Không dùng `createMockProxy` (không có trong repo).
- Mỗi handler có spec cạnh file (`checkout.handler.spec.ts`, `cancel-order.handler.spec.ts`...).

### 10.3 Integration test (mẫu thật)
```ts
// apps/orders/test/order-transition.int-spec.ts (rút gọn)
describeWithDb('OrderTransitionService (postgres)', ({ it }) => {
  it('hai transaction cùng đọc version 1: đúng một bên thắng', async (ds) => {
    // ds là DataSource đã kết nối tới INT_DB_NAME (mặc định ecommerce_test)
    // ...
  });
});
```
- `describeWithDb` (`libs/database/test/integration-data-source.ts`) không chạy migration. Schema phải có sẵn (`loadtest/migrate.js` hoặc migration).
- **Không có Postgres thì suite vẫn "pass" rỗng** và in `[integration] bỏ qua ...`. Khi xác nhận int-spec, kiểm tra không có dòng `bỏ qua` trong log.
- Chạy: `INT_DB_NAME=ecommerce_test npm run test:int`. Thêm `INT_KAFKA=1` cho `libs/messaging/test/kafka-producer.int-spec.ts`. Trạng thái: 10/10 suite, 33/33 test pass (xem [integration-test-report.md](../plans/261015-1700-checkout-v2-event-driven/reports/integration-test-report.md)).

### 10.4 Mock module ESM-only và module nặng
Jest chạy CJS, một số package là ESM-only nên phải mock trước khi import:
```ts
// apps/orders/src/jobs/order-lifecycle.scheduler.spec.ts: scheduler không chạy cron thật
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_30_SECONDS: '*/30 * * * * *', EVERY_10_MINUTES: '0 */10 * * * *' },
}));

// apps/notification/src/health/health.controller.spec.ts: @nestjs/terminus là ESM-only
jest.mock('@nestjs/terminus', () => ({
  HealthCheck: () => () => undefined,
  HealthCheckService: class {},
  TypeOrmHealthIndicator: class {},
}));

// apps/orders/test/checkout.int-spec.ts: CartService kéo @lib/cached → @nestjs/terminus (ESM), chỉ cần token DI
jest.mock('../src/cart/cart.service', () => ({ CartService: class CartService {} }));
```
Mock `@nestjs/schedule` cũng có trong `apps/inventory/src/jobs/reservation-expiry.job.spec.ts`. Khi thêm spec mới cho handler kéo `@lib/cached`, mock `cart.service` theo cách trên.

### 10.5 Coverage
- Mục tiêu: **≥70%** dòng cho code mới; luồng critical (Saga đã xoá, Outbox/Inbox, Payment, Inventory) nhắm 90%+.
- **Chưa có báo cáo coverage** được đo cho toàn repo. Đừng khẳng định con số coverage khi chưa chạy `npm run test:cov`.
- Các spec boilerplate cũ đang fail: `apps/gateway/src/gateway.controller.spec.ts` (thiếu provider `USER_SERVICE`), `apps/user/src/user.controller.spec.ts` (không parse được). Không coi là phép đo chất lượng.

---

## 11. Logging Standards

- Dùng `Logger` của `@nestjs/common` với context là tên class. Không `console.log`.
  ```ts
  private readonly logger = new Logger(CheckoutHandler.name);
  this.logger.warn(`[${consumer}] ${message.type} ${message.eventId} lỗi lần ${attempt}/${max}: ${err.message}`);
  ```
- Log theo mẫu có ngữ cảnh (consumer, eventId, orderId). Không log secret, token, mật khẩu.
- Ngoại lệ đã biết: `ProductCreatedEvent` handler dùng `console.log` (stub).

---

## 12. Common Pitfalls & Anti-Patterns

### ❌ Tin giá hoặc số lượng từ client
Hiện không còn đường nào nhận `unitPrice`, `quantity` hay `userId` từ body (Gateway và Orders đều loại field lạ). Giá lấy từ Product, số lượng lấy từ cart. `OrderPricingService` gọi `ProductClient.getProduct` (TCP `get_product`, timeout 10 giây); Product trả 404 thì Orders trả 400:
```ts
// apps/orders/src/pricing/order-pricing.service.ts (rút gọn)
const product = await this.products.getProduct(productId);
const price = Number(product?.price);
if (!product || !product.isActive || !Number.isFinite(price) || price < 0) {
  throw invalidProduct(productId); // RpcException 400
}
return toMoney(price);
```

### ❌ Event loss (ghi DB rồi emit riêng)
```ts
// SAI: ghi DB xong mới phát; crash giữa hai bước là mất event
await this.orderRepository.save(order);
this.kafka.emit('order.created', order);
```
**Đúng**: ghi state và outbox trong cùng transaction (`dataSource.transaction`), relay đẩy Kafka sau (`OutboxRelayService`, at-least-once):
```ts
await this.dataSource.transaction(async (manager) => {
  await manager.insert(Order, order);
  await this.outbox.append(manager, {
    topic: KAFKA_TOPIC.ORDER_EVENTS,
    type: MESSAGE_TYPE.ORDER_CREATED,
    orderId: order.id,
    payload: { userId: order.userId, totalAmount: order.totalAmount, expiresAt },
  });
});
```

### ❌ Đọc rồi ghi không kiểm tra điều kiện (race)
```ts
// SAI: đọc, kiểm tra, ghi không nguyên tử
const order = await repo.findOne({ where: { id } });
order.status = OrderStatus.PAID;
await repo.save(order); // save() ghi đè, không kiểm tra version
```
**Đúng** (optimistic lock, mẫu `OrderTransitionService`): chỉ ghi khi version vẫn là version đã đọc. 0 dòng bị ảnh hưởng → báo lỗi 409 hoặc để consumer retry và đọc lại:
```ts
const result = await manager.update(
  Order,
  { id: order.id, version: order.version },
  { status: to, version: () => 'version + 1' },
);
if (!result.affected) throw new OrderVersionConflictError(order.id);
```

### ❌ Trừ tồn kho bằng đọc-rồi-ghi
**Đúng** (mẫu `ReservationService`, Inventory): khoá mọi dòng `stock_items` cần ghi bằng một câu `ORDER BY id FOR UPDATE`, kiểm đủ hàng cho cả đơn **trước** khi ghi, rồi cập nhật `reserved`. Ràng buộc DB `CHECK (reserved >= 0 AND "onHand" >= reserved)` là chốt chặn cuối cùng.

### ❌ Thanh toán không có idempotency key
**Đúng**: Payment nhận `idempotencyKey = orderId` khi tạo intent. Gọi lại cùng `orderId` trả lại intent cũ, không tạo intent mới. Webhook dedup theo `eventId` (`payment_webhook_logs`).

---

## 13. Dead Code & Cleanup Candidates

| Mục | Trạng thái | Hành động |
|---|---|---|
| `libs/common/src/constant/cmd.ts` (`CMD.GET_USER_INFO`) | **Vẫn được dùng** bởi `apps/user/src/user.controller.ts` và `apps/notification/src/order-events.controller.ts`. Cùng giá trị `get_user_info` với `USER_MESSAGE_PATTERN.GET_USER_INFO` | Chuyển hai nơi sang `libs/constant/message-pattern.constant.ts`, rồi xoá file |
| `amqp-connection-manager`, `amqplib` trong `package.json` | Không còn import nào trong `apps/` và `libs/` | Gỡ khỏi `package.json` |
| `apps/gateway/src/common/interceptor/response.interceptor.ts` | Không đăng ký ở `GatewayModule` (chỉ `TransformInterceptor` được dùng) | Xoá hoặc đăng ký có chủ đích |
| `apps/gateway/src/gateway.controller.spec.ts`, `apps/user/src/user.controller.spec.ts` | Boilerplate fail | Sửa hoặc xoá |

---

## 14. Checklists for Code Review

### Trước khi commit
- [ ] DTO dùng decorator `class-validator`
- [ ] Không đọc `process.env` trong logic nghiệp vụ (dùng `ConfigService`)
- [ ] CQRS service có `commands/`, `queries/`, handler tương ứng
- [ ] Lỗi là `RpcException` hoặc exception built-in của Nest
- [ ] Không log secret, token, mật khẩu
- [ ] Ghi DB có khoá phù hợp (optimistic `version` hoặc pessimistic)
- [ ] Mọi `@MessagePattern` có `Transport.TCP`, mọi `@EventPattern` có `Transport.KAFKA`
- [ ] Gọi TCP có timeout và xử lý lỗi (`TcpResilienceService` ở Gateway)
- [ ] Đặt tên đúng: DB snake_case cho bảng, camelCase cho cột và code; `MESSAGE_TYPE` PascalCase

### Cho luồng critical (checkout, outbox, payment, inventory)
- [ ] Có idempotency key (header ở Gateway, `orderId` ở Payment/Inventory)
- [ ] Đổi state và ghi outbox trong cùng transaction
- [ ] Consumer dùng `KafkaConsumerRunner` (inbox + retry + DLQ) và kiểm tra lại trạng thái sau khi đọc lại
- [ ] Có test lỗi và bù trừ (unit mock); luồng DB thật có int-spec
- [ ] Đã chạy E2E thủ công theo runbook nếu thay đổi luồng checkout

---

## References
- Root [CLAUDE.md](../CLAUDE.md): quy tắc cấp dự án và tóm tắt kiến trúc (§2.1)
- `apps/<service>/CLAUDE.md`: quy tắc riêng từng service (ví dụ [apps/orders/CLAUDE.md](../apps/orders/CLAUDE.md))
- `libs/constant/`: message pattern, Kafka topic/type/group, permission, port
- `libs/messaging/`: outbox, inbox, consumer runner, envelope
- `libs/database/src/migrations/`: thay đổi schema (đọc để biết cấu trúc DB hiện tại)
