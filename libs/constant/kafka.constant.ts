export const KAFKA_TOPIC = {
	ORDER_EVENTS: 'order-events',
	PAYMENT_EVENTS: 'payment-events',
	PAYMENT_COMMANDS: 'payment-commands',
	INVENTORY_COMMANDS: 'inventory-commands',
	INVENTORY_EVENTS: 'inventory-events',
	SHIPPING_COMMANDS: 'shipping-commands',
	SHIPPING_EVENTS: 'shipping-events',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPIC)[keyof typeof KAFKA_TOPIC];

/** Dead-letter topic của một topic nguồn. */
export const dlqTopic = (topic: string): string => `${topic}.dlq`;

export const MESSAGE_TYPE = {
	// order-events
	ORDER_CREATED: 'OrderCreated',
	ORDER_STATUS_CHANGED: 'OrderStatusChanged',
	ORDER_PAID: 'OrderPaid',
	ORDER_CANCELLED: 'OrderCancelled',
	// inventory-commands
	COMMIT_INVENTORY: 'CommitInventory',
	RELEASE_INVENTORY: 'ReleaseInventory',
	RESTOCK_INVENTORY: 'RestockInventory',
	// inventory-events
	INVENTORY_COMMITTED: 'InventoryCommitted',
	INVENTORY_COMMIT_FAILED: 'InventoryCommitFailed',
	// payment-commands
	REFUND_PAYMENT: 'RefundPayment',
	CANCEL_PAYMENT_INTENT: 'CancelPaymentIntent',
	// payment-events
	PAYMENT_SUCCEEDED: 'PaymentSucceeded',
	PAYMENT_FAILED: 'PaymentFailed',
	PAYMENT_REFUNDED: 'PaymentRefunded',
	PAYMENT_REFUND_FAILED: 'PaymentRefundFailed',
	// shipping-commands
	CREATE_SHIPMENT: 'CreateShipment',
	CANCEL_SHIPMENT: 'CancelShipment',
	// shipping-events
	SHIPMENT_CREATED: 'ShipmentCreated',
	SHIPMENT_DELIVERED: 'ShipmentDelivered',
	SHIPMENT_FAILED: 'ShipmentFailed',
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

/** Consumer group = tên service; cũng là khoá `consumer` của bảng processed_messages. */
export const CONSUMER_GROUP = {
	ORDERS: 'orders-service',
	INVENTORY: 'inventory-service',
	PAYMENT: 'payment-service',
	SHIPPING: 'shipping-service',
	NOTIFICATION: 'notification-service',
	PROMOTION: 'promotion-service',
} as const;

/** Giá trị cột `outbox.source`: mỗi service chỉ relay row của chính nó (chung một bảng). */
export const OUTBOX_SOURCE = {
	ORDERS: 'orders',
	INVENTORY: 'inventory',
	PAYMENT: 'payment',
	SHIPPING: 'shipping',
} as const;
