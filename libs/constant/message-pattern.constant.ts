export const USER_MESSAGE_PATTERN = {
	GET_USER_INFO: 'get_user_info',
	LOGOUT_USER: 'logout_user',
	REGISTER_USER: 'register_user',
	LOGIN_USER: 'login_user',
	VERIFY_TOKEN: 'verify_token',
	UPDATE_AVATAR: 'update_avatar',
};

export const PRODUCT_MESSAGE_PATTERN = {
	CREATE_PRODUCT: 'create_product',
	GET_PRODUCTS: 'get_products',
	GET_PRODUCT: 'get_product',
	UPDATE_PRODUCT: 'update_product',
	DELETE_PRODUCT: 'delete_product',
	ADJUST_STOCK: 'adjust_stock',
	CREATE_BRAND: 'create_brand',
	GET_BRANDS: 'get_brands',
	UPDATE_BRAND: 'update_brand',
	DELETE_BRAND: 'delete_brand',
	CREATE_ATTRIBUTE: 'create_attribute',
	GET_ATTRIBUTES: 'get_attributes',
	UPDATE_ATTRIBUTE: 'update_attribute',
	DELETE_ATTRIBUTE: 'delete_attribute',
	CREATE_VARIANT: 'create_variant',
	GET_VARIANTS: 'get_variants',
	UPDATE_VARIANT: 'update_variant',
	DELETE_VARIANT: 'delete_variant',
};

export const ORDER_MESSAGE_PATTERN = {
	CREATE_ORDER: 'create_order',
	GET_ORDERS: 'get_orders',
	GET_ORDER: 'get_order',
	UPDATE_ORDER_STATUS: 'update_order_status',
	CREATE_REFUND: 'create_refund',
	APPROVE_REFUND: 'approve_refund',
	REJECT_REFUND: 'reject_refund',
	GET_REFUNDS: 'get_refunds',
	CHECKOUT: 'checkout_order',
	GET_PAYMENT_LINK: 'get_order_payment_link',
	CANCEL_ORDER: 'cancel_order',
	REQUEST_RETURN: 'request_order_return',
};

export const CART_MESSAGE_PATTERN = {
	GET_CART: 'get_cart',
	ADD_TO_CART: 'add_to_cart',
	UPDATE_CART_ITEM: 'update_cart_item',
	REMOVE_FROM_CART: 'remove_from_cart',
	CLEAR_CART: 'clear_cart',
};

export const HEALTH_MESSAGE_PATTERN = {
	HEALTH_CHECK: 'health_check',
};

export const ADDRESS_MESSAGE_PATTERN = {
	CREATE_ADDRESS: 'create_address',
	GET_ADDRESSES: 'get_addresses',
	UPDATE_ADDRESS: 'update_address',
	DELETE_ADDRESS: 'delete_address',
	SET_DEFAULT_ADDRESS: 'set_default_address',
};

export const ROLE_MESSAGE_PATTERN = {
	CREATE_ROLE: 'create_role',
	GET_ROLES: 'get_roles',
	UPDATE_ROLE: 'update_role',
	DELETE_ROLE: 'delete_role',
	ASSIGN_ROLE: 'assign_role',
	REMOVE_ROLE: 'remove_role',
};

export const PAYMENT_MESSAGE_PATTERN = {
	CHARGE_PAYMENT: 'charge_payment',
	HANDLE_WEBHOOK: 'handle_payment_webhook',
	GET_TRANSACTION: 'get_transaction',
	CREATE_INTENT: 'create_payment_intent',
	GET_INTENT: 'get_payment_intent',
	SIMULATE_PAYMENT: 'simulate_payment',
};

export const PAYMENT_EVENT_PATTERN = {
	PAYMENT_SUCCEEDED: 'payment_succeeded',
	PAYMENT_FAILED: 'payment_failed',
};

export const NOTIFICATION_MESSAGE_PATTERN = {
	GET_SENT_NOTIFICATIONS: 'get_sent_notifications',
};

export const REVIEW_MESSAGE_PATTERN = {
	CREATE_REVIEW: 'create_review',
	GET_REVIEWS_BY_PRODUCT: 'get_reviews_by_product',
};

export const PROMOTION_MESSAGE_PATTERN = {
	CREATE_VOUCHER: 'create_voucher',
	GET_VOUCHERS: 'get_vouchers',
	GET_AVAILABLE_VOUCHERS: 'get_available_vouchers',
	APPLY_VOUCHER: 'apply_voucher',
	VALIDATE_VOUCHER: 'validate_voucher',
	RESERVE_VOUCHER: 'reserve_voucher',
	RELEASE_VOUCHER: 'release_voucher',
};

export const INVENTORY_MESSAGE_PATTERN = {
	RESERVE: 'inventory_reserve',
	CHECK_RESERVATION: 'inventory_check_reservation',
	RELEASE: 'inventory_release',
	ADJUST_STOCK: 'inventory_adjust_stock',
	GET_AVAILABILITY: 'inventory_get_availability',
};

export const SHIPPING_MESSAGE_PATTERN = {
	HANDLE_WEBHOOK: 'handle_shipping_webhook',
	SIMULATE_DELIVERY: 'simulate_shipping_delivery',
	GET_SHIPMENT: 'get_shipment',
};
