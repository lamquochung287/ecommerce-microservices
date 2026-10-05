# Graph Report - ecommerce-system  (2026-10-01)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2054 nodes · 4363 edges · 130 communities (77 shown, 53 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 88 edges (avg confidence: 0.8)
- Token cost: 145,506 input · 2,903 output

## Graph Freshness
- Built from commit: `04fc6df3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Address Management
- Promotion & Vouchers
- Review Creation
- Package Config & Dependencies
- Product Create/Update
- Permission & JWT Guards
- User Controller & Decorators
- Order Creation
- Core Module Imports
- Dev Dependencies
- Refund & Order Status
- Attribute Entity & Handlers
- Runtime Dependencies
- Order Entity Model
- Response Transform & Resilience
- Cart TCP Controller
- Attribute Controller & Filters
- Product Catalog Commands
- NPM Scripts
- TCP Resilience & Idempotency
- Product Controller
- Variant Entity & Handlers
- Outbox Pattern
- Role & User Entities
- User Entity & Service
- Microservice Bootstrap & Filters
- Role Controller (TCP)
- TypeScript Config
- Orders Controller
- Product Controller (Full)
- Cart Controller (HTTP)
- Payment Controller
- Refund Entity & Handler
- Brand Commands
- Refund DTO & Controller
- Notification Entity & Health
- App Module Bootstrapping
- Refund Service & Controller
- Brand Controller
- Order Status DTOs
- Module Config & Database
- Review Controller
- User Service Methods
- RPC Exception Filters
- Payment Webhook Commands
- Role Controller (HTTP)
- Payment Transaction Module
- User Auth DTOs & Service
- User Module & DTOs
- Variant Controller
- Email/Push Providers
- Product DTOs & Commands
- Jest Config
- Variant DTOs
- Gateway Controller
- Health Check Controllers
- Common Config & Pagination
- Charge Payment Handler
- Idempotency & Cache Service
- Payment Webhook Handler
- Payment Provider Interface
- Get Products Query
- Notification TS Config
- Stock Adjustment
- Health Check (Redis)
- Sent Notification Entity
- Orders Health Check
- Payment TCP Controller
- Product Health Check
- Redis Cache Module
- Nest CLI Config
- Gateway Health Check
- Reject Refund Handler
- Get Transaction Query
- User TCP Controller
- Notification Health Check
- Delete Brand Command
- Get Brands Query
- Get Product Query
- Get Variants Query
- Review Health Check
- Product App Config
- Gateway Bootstrap & Filter
- Gateway TS Config
- Order Event Listener
- Order Created Event
- Orders TS Config
- Payment TS Config
- Product Created Event
- Product TS Config
- Promotion TS Config
- Review TS Config
- User TS Config
- Cached Lib TS Config
- Common Module & Service
- Pagination DTO
- Common Lib TS Config
- Database Lib TS Config
- Media Lib TS Config
- Health Check Controller
- Cached Lib Config
- Common Lib Config
- Database Lib Config
- Gateway App Config
- Media App Config
- Notification App Config
- Orders App Config
- Payment App Config
- Promotion App Config
- Review App Config
- User App Config
- Response Interceptor
- User DTOs
- Delete Product Command
- Available Vouchers Query
- Get Vouchers Query
- Review Service Bootstrap
- Load Testing Script
- Apply Voucher Command
- Initial Schema Migration
- Outbox Table Migration
- Product Catalog Migration
- Product Version Column Migration
- Order Saga Refund Migration
- RBAC Address Book Migration
- Payment Notification Promotion Migration
- User Avatar URL Migration
- User Entity

## God Nodes (most connected - your core abstractions)
1. `@nestjs/common` - 117 edges
2. `typeorm` - 74 edges
3. `@nestjs/microservices` - 72 edges
4. `RequirePermission()` - 51 edges
5. `@nestjs/cqrs` - 50 edges
6. `@nestjs/typeorm` - 49 edges
7. `ProductService` - 33 edges
8. `Product` - 32 edges
9. `scripts` - 30 edges
10. `User` - 29 edges

## Surprising Connections (you probably didn't know these)
- `ReviewRpcExceptionFilter` --inherits--> `AbstractRpcExceptionFilter`  [EXTRACTED]
  apps/review/src/filters/rpc-exception.filter.ts → libs/common/src/filters/base-rpc-exception.filter.ts
- `PromotionRpcExceptionFilter` --inherits--> `AbstractRpcExceptionFilter`  [EXTRACTED]
  apps/promotion/src/filters/rpc-exception.filter.ts → libs/common/src/filters/base-rpc-exception.filter.ts
- `UserRpcExceptionFilter` --inherits--> `AbstractRpcExceptionFilter`  [EXTRACTED]
  apps/user/src/filters/rpc-exception.filter.ts → libs/common/src/filters/base-rpc-exception.filter.ts
- `GetProductsFilterDto` --inherits--> `PaginationQueryDto`  [EXTRACTED]
  apps/product/src/dto/product.dto.ts → libs/common/src/pagination/pagination-query.dto.ts
- `NotificationRpcExceptionFilter` --inherits--> `AbstractRpcExceptionFilter`  [EXTRACTED]
  apps/notification/src/filters/rpc-exception.filter.ts → libs/common/src/filters/base-rpc-exception.filter.ts

## Import Cycles
- None detected.

## Communities (130 total, 53 thin omitted)

### Community 0 - "Address Management"
Cohesion: 0.05
Nodes (11): AddressController, AddressController, CreateAddressDto, UpdateAddressDto, AddressModule, AddressService, baseAddress, dataSource (+3 more)

### Community 1 - "Promotion & Vouchers"
Cohesion: 0.06
Nodes (13): PromotionController, PromotionService, ApplyVoucherCommand, CreateVoucherCommand, CreateVoucherHandler, ApplyVoucherDto, CreateVoucherDto, DiscountType (+5 more)

### Community 2 - "Review Creation"
Cohesion: 0.06
Nodes (14): CreateReviewCommand, CreateReviewHandler, OrderSummary, REVIEWABLE_STATUSES, CreateReviewDto, Review, HealthModule, ORDER_TCP_CLIENT (+6 more)

### Community 3 - "Package Config & Dependencies"
Cohesion: 0.04
Nodes (46): author, description, license, name, private, version, amqp-connection-manager, amqplib (+38 more)

### Community 4 - "Product Create/Update"
Cohesion: 0.07
Nodes (7): CreateProductCommand, CreateProductHandler, UpdateProductHandler, UpdateProductCommand, Brand, Category, Product

### Community 5 - "Permission & JWT Guards"
Cohesion: 0.15
Nodes (20): PERMISSION_KEY, RequirePermission(), JwtAuthGuard, PermissionGuard, Action, ALL, CREATE, DELETE (+12 more)

### Community 6 - "User Controller & Decorators"
Cohesion: 0.08
Nodes (7): GetUser, UserController, MEDIA_BUCKET, MINIO_CLIENT, MediaModule, MediaService, minio

### Community 7 - "Order Creation"
Cohesion: 0.10
Nodes (13): CreateOrderCommand, CreateOrderHandler, baseDto, dataSource, InventoryReservationService, ReservationItem, PAYMENT_TCP_CLIENT, CaptureResult (+5 more)

### Community 8 - "Core Module Imports"
Cohesion: 0.18
Nodes (8): CommandHandlers, EventHandlers, QueryHandlers, Voucher, @nestjs/cqrs, @nestjs/microservices, @nestjs/typeorm, typeorm

### Community 9 - "Dev Dependencies"
Cohesion: 0.05
Nodes (37): devDependencies, autocannon, concurrently, dotenv, eslint, eslint-config-prettier, @eslint/eslintrc, @eslint/js (+29 more)

### Community 10 - "Refund & Order Status"
Cohesion: 0.09
Nodes (20): ApproveRefundCommand, ApproveRefundHandler, REFUNDABLE_STATUSES, UpdateOrderStatusHandler, OrderStatus, CANCELLED, DELIVERED, PAID (+12 more)

### Community 11 - "Attribute Entity & Handlers"
Cohesion: 0.06
Nodes (6): CreateAttributeHandler, DeleteAttributeHandler, UpdateAttributeHandler, Attribute, AttributeValue, GetAttributesHandler

### Community 12 - "Runtime Dependencies"
Cohesion: 0.06
Nodes (36): dependencies, amqp-connection-manager, amqplib, bcrypt, class-transformer, class-validator, compression, helmet (+28 more)

### Community 13 - "Order Entity Model"
Cohesion: 0.07
Nodes (9): Order, OrderItem, CommandHandlers, EventHandlers, QueryHandlers, GetOrdersQuery, GetOrderHandler, GetOrdersHandler (+1 more)

### Community 14 - "Response Transform & Resilience"
Cohesion: 0.07
Nodes (11): ResponseEnvelope, TransformInterceptor, RequestTrackerMiddleware, TcpResilienceModule, GatewayModule, HealthModule, OrdersModule, PromotionModule (+3 more)

### Community 15 - "Cart TCP Controller"
Cohesion: 0.14
Nodes (5): CartController, Cart, CartItemDto, CartModule, CartService

### Community 16 - "Attribute Controller & Filters"
Cohesion: 0.09
Nodes (3): AttributeController, ProductModule, ProductService

### Community 17 - "Product Catalog Commands"
Cohesion: 0.10
Nodes (11): CreateAttributeCommand, CreateVariantCommand, DeleteAttributeCommand, DeleteProductCommand, DeleteVariantCommand, UpdateAttributeCommand, UpdateVariantCommand, AddAttributeValueDto (+3 more)

### Community 18 - "NPM Scripts"
Cohesion: 0.07
Nodes (30): scripts, build, dev, docker:down, docker:up, format, lint, migration:generate (+22 more)

### Community 19 - "TCP Resilience & Idempotency"
Cohesion: 0.15
Nodes (15): MicroserviceErrorHandler, BREAKER_OPTIONS, TcpResilienceService, ADDRESS_MESSAGE_PATTERN, CART_MESSAGE_PATTERN, ORDER_MESSAGE_PATTERN, PAYMENT_MESSAGE_PATTERN, PRODUCT_MESSAGE_PATTERN (+7 more)

### Community 21 - "Variant Entity & Handlers"
Cohesion: 0.07
Nodes (4): CreateVariantHandler, DeleteVariantHandler, UpdateVariantHandler, ProductVariant

### Community 22 - "Outbox Pattern"
Cohesion: 0.12
Nodes (10): Outbox, OutboxStatus, FAILED, PENDING, PUBLISHED, NOTIFICATION_TCP_CLIENT, ORDER_TCP_CLIENT, OutboxModule (+2 more)

### Community 23 - "Role & User Entities"
Cohesion: 0.15
Nodes (4): Role, UserRole, RoleService, dataSource

### Community 25 - "Microservice Bootstrap & Filters"
Cohesion: 0.13
Nodes (13): PromotionRpcExceptionFilter, bootstrap(), UserRpcExceptionFilter, bootstrap(), setupTracing(), PORT_TCP, @nestjs/core, @opentelemetry/auto-instrumentations-node (+5 more)

### Community 26 - "Role Controller (TCP)"
Cohesion: 0.14
Nodes (4): RoleController, AssignRoleDto, CreateRoleDto, UpdateRoleDto

### Community 27 - "TypeScript Config"
Cohesion: 0.08
Nodes (23): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, forceConsistentCasingInFileNames, incremental (+15 more)

### Community 31 - "Payment Controller"
Cohesion: 0.12
Nodes (4): PaymentController, PaymentModule, PaymentService, PaymentWebhookController

### Community 32 - "Refund Entity & Handler"
Cohesion: 0.10
Nodes (4): CreateRefundHandler, Refund, GetRefundsQuery, GetRefundsHandler

### Community 33 - "Brand Commands"
Cohesion: 0.13
Nodes (6): CreateBrandCommand, CreateBrandHandler, UpdateBrandHandler, UpdateBrandCommand, CreateBrandDto, UpdateBrandDto

### Community 34 - "Refund DTO & Controller"
Cohesion: 0.17
Nodes (3): CreateRefundCommand, CreateRefundDto, OrdersController

### Community 35 - "Notification Entity & Health"
Cohesion: 0.15
Nodes (12): NotificationChannel, EMAIL, PUSH, NotificationStatus, FAILED, SENT, HealthModule, NotificationController (+4 more)

### Community 36 - "App Module Bootstrapping"
Cohesion: 0.12
Nodes (8): OrdersModule, ProductModule, HealthModule, RoleModule, UserModule, @nestjs/jwt, @nestjs/testing, supertest

### Community 39 - "Order Status DTOs"
Cohesion: 0.15
Nodes (5): UpdateOrderStatusCommand, CreateOrderDto, OrderItemDto, UpdateOrderStatusDto, GetOrderQuery

### Community 40 - "Module Config & Database"
Cohesion: 0.12
Nodes (7): HealthModule, CommandHandlers, PromotionModule, QueryHandlers, CommonConfigModule, DatabaseModule, DatabaseService

### Community 43 - "RPC Exception Filters"
Cohesion: 0.19
Nodes (5): NotificationRpcExceptionFilter, bootstrap(), PaymentRpcExceptionFilter, bootstrap(), AbstractRpcExceptionFilter

### Community 44 - "Payment Webhook Commands"
Cohesion: 0.20
Nodes (3): ChargePaymentCommand, ChargePaymentDto, PaymentWebhookDto

### Community 46 - "Payment Transaction Module"
Cohesion: 0.18
Nodes (10): PaymentTransactionStatus, FAILED, SUCCEEDED, HealthModule, ORDER_TCP_CLIENT, CommandHandlers, PaymentModule, QueryHandlers (+2 more)

### Community 47 - "User Auth DTOs & Service"
Cohesion: 0.18
Nodes (3): LoginUserDTO, RegisterUserDTO, CMD

### Community 48 - "User Module & DTOs"
Cohesion: 0.23
Nodes (4): LoginUserDto, RegisterUserDto, UserModule, @nestjs/platform-express

### Community 50 - "Email/Push Providers"
Cohesion: 0.22
Nodes (6): EmailProvider, SendResult, PUSH_PROVIDER, PushProvider, SimulatedEmailProvider, SimulatedPushProvider

### Community 51 - "Product DTOs & Commands"
Cohesion: 0.23
Nodes (3): CreateProductDto, GetProductsFilterDto, UpdateProductDto

### Community 52 - "Jest Config"
Cohesion: 0.12
Nodes (16): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, moduleNameMapper, rootDir, roots, testEnvironment (+8 more)

### Community 53 - "Variant DTOs"
Cohesion: 0.23
Nodes (4): AdjustStockDto, CreateVariantDto, UpdateVariantDto, class-validator

### Community 55 - "Health Check Controllers"
Cohesion: 0.20
Nodes (3): HealthController, HEALTH_MESSAGE_PATTERN, @nestjs/terminus

### Community 56 - "Common Config & Pagination"
Cohesion: 0.18
Nodes (5): PaginatedResult, PaginationMeta, EnvironmentVariables, validateEnv(), class-transformer

### Community 60 - "Payment Provider Interface"
Cohesion: 0.21
Nodes (4): ChargeResult, PaymentProvider, WebhookVerifyResult, SimulatedPaymentProvider

### Community 61 - "Get Products Query"
Cohesion: 0.21
Nodes (4): GetProductsQuery, GetProductsHandler, SORTABLE_FIELDS, buildPaginationMeta()

### Community 63 - "Notification TS Config"
Cohesion: 0.18
Nodes (9): compilerOptions, declaration, outDir, exclude, extends, include, exclude, extends (+1 more)

### Community 64 - "Stock Adjustment"
Cohesion: 0.29
Nodes (3): AdjustStockCommand, AdjustStockHandler, dataSource

### Community 70 - "Redis Cache Module"
Cohesion: 0.42
Nodes (3): REDIS_CLIENT, CachedModule, ioredis

### Community 71 - "Nest CLI Config"
Cohesion: 0.20
Nodes (9): collection, compilerOptions, deleteOutDir, plugins, webpack, monorepo, root, $schema (+1 more)

### Community 82 - "Product App Config"
Cohesion: 0.25
Nodes (8): tsConfigPath, compilerOptions, compilerOptions, entryFile, root, sourceRoot, type, product

### Community 83 - "Gateway Bootstrap & Filter"
Cohesion: 0.33
Nodes (4): HttpExceptionFilter, bootstrap(), compression, helmet

### Community 84 - "Gateway TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 87 - "Orders TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 88 - "Payment TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 90 - "Product TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 91 - "Promotion TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 92 - "Review TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 93 - "User TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 94 - "Cached Lib TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 97 - "Common Lib TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 98 - "Database Lib TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 99 - "Media Lib TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, exclude, extends, include

### Community 101 - "Cached Lib Config"
Cohesion: 0.33
Nodes (6): compilerOptions, entryFile, root, sourceRoot, type, cached

### Community 102 - "Common Lib Config"
Cohesion: 0.33
Nodes (6): compilerOptions, entryFile, root, sourceRoot, type, common

### Community 103 - "Database Lib Config"
Cohesion: 0.33
Nodes (6): compilerOptions, entryFile, root, sourceRoot, type, database

### Community 104 - "Gateway App Config"
Cohesion: 0.33
Nodes (6): compilerOptions, entryFile, root, sourceRoot, type, gateway

### Community 105 - "Media App Config"
Cohesion: 0.33
Nodes (6): entryFile, root, sourceRoot, type, projects, media

### Community 106 - "Notification App Config"
Cohesion: 0.33
Nodes (6): compilerOptions, entryFile, root, sourceRoot, type, notification

### Community 107 - "Orders App Config"
Cohesion: 0.33
Nodes (6): compilerOptions, entryFile, root, sourceRoot, type, orders

### Community 108 - "Payment App Config"
Cohesion: 0.33
Nodes (6): compilerOptions, entryFile, root, sourceRoot, type, payment

### Community 109 - "Promotion App Config"
Cohesion: 0.33
Nodes (6): promotion, compilerOptions, entryFile, root, sourceRoot, type

### Community 110 - "Review App Config"
Cohesion: 0.33
Nodes (6): review, compilerOptions, entryFile, root, sourceRoot, type

### Community 111 - "User App Config"
Cohesion: 0.33
Nodes (6): user, compilerOptions, entryFile, root, sourceRoot, type

### Community 113 - "User DTOs"
Cohesion: 0.50
Nodes (3): CreateUserDto, UpdateUserDto, @nestjs/mapped-types

### Community 118 - "Load Testing Script"
Cohesion: 0.40
Nodes (3): autocannon, { execSync }, runTest()

## Knowledge Gaps
- **355 isolated node(s):** `IResponse`, `UpdateUserDto`, `User`, `ResponseEnvelope`, `OrderSummary` (+350 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 901 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **53 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@nestjs/common` connect `TCP Resilience & Idempotency` to `Address Management`, `Promotion & Vouchers`, `Review Creation`, `Package Config & Dependencies`, `Permission & JWT Guards`, `User Controller & Decorators`, `Order Creation`, `Core Module Imports`, `Order Entity Model`, `Response Transform & Resilience`, `Cart TCP Controller`, `Attribute Controller & Filters`, `Product Catalog Commands`, `Outbox Pattern`, `Role & User Entities`, `Microservice Bootstrap & Filters`, `Payment Controller`, `Notification Entity & Health`, `App Module Bootstrapping`, `Order Status DTOs`, `Module Config & Database`, `RPC Exception Filters`, `Payment Webhook Commands`, `Payment Transaction Module`, `User Auth DTOs & Service`, `User Module & DTOs`, `Email/Push Providers`, `Gateway Controller`, `Health Check Controllers`, `Common Config & Pagination`, `Payment Provider Interface`, `Orders Health Check`, `Product Health Check`, `Redis Cache Module`, `Notification Health Check`, `Review Health Check`, `Gateway Bootstrap & Filter`, `Common Module & Service`, `Response Interceptor`, `Review Service Bootstrap`?**
  _High betweenness centrality (0.330) - this node is a cross-community bridge._
- **Why does `@nestjs/microservices` connect `Core Module Imports` to `Address Management`, `Promotion & Vouchers`, `Review Creation`, `Package Config & Dependencies`, `Product Create/Update`, `Permission & JWT Guards`, `Order Creation`, `Refund & Order Status`, `Cart TCP Controller`, `Attribute Controller & Filters`, `Product Catalog Commands`, `TCP Resilience & Idempotency`, `Outbox Pattern`, `Role & User Entities`, `Microservice Bootstrap & Filters`, `Payment Controller`, `Brand Commands`, `Notification Entity & Health`, `Order Status DTOs`, `RPC Exception Filters`, `Payment Webhook Commands`, `Payment Transaction Module`, `User Auth DTOs & Service`, `User Module & DTOs`, `Gateway Controller`, `Health Check Controllers`, `Stock Adjustment`, `Orders Health Check`, `Product Health Check`, `Reject Refund Handler`, `Notification Health Check`, `Review Health Check`, `Review Service Bootstrap`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `typeorm` connect `Core Module Imports` to `Address Management`, `Review Creation`, `Package Config & Dependencies`, `Product Create/Update`, `Order Creation`, `Refund & Order Status`, `Order Entity Model`, `Outbox Pattern`, `Role & User Entities`, `Refund Entity & Handler`, `Brand Commands`, `Notification Entity & Health`, `Payment Transaction Module`, `User Auth DTOs & Service`, `Get Products Query`, `Stock Adjustment`, `Reject Refund Handler`, `Get Transaction Query`, `Get Brands Query`, `Initial Schema Migration`, `Outbox Table Migration`, `Product Catalog Migration`, `Product Version Column Migration`, `Order Saga Refund Migration`, `RBAC Address Book Migration`, `Payment Notification Promotion Migration`, `User Avatar URL Migration`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **What connects `IResponse`, `UpdateUserDto`, `User` to the rest of the system?**
  _355 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Address Management` be split into smaller, more focused modules?**
  _Cohesion score 0.05406746031746032 - nodes in this community are weakly interconnected._
- **Should `Promotion & Vouchers` be split into smaller, more focused modules?**
  _Cohesion score 0.05649717514124294 - nodes in this community are weakly interconnected._
- **Should `Review Creation` be split into smaller, more focused modules?**
  _Cohesion score 0.058001397624039136 - nodes in this community are weakly interconnected._