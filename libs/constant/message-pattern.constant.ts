export const USER_MESSAGE_PATTERN = {
    GET_USER_INFO: 'get_user_info',
    LOGOUT_USER: 'logout_user',
    REGISTER_USER: 'register_user',
    LOGIN_USER: 'login_user',
    VERIFY_TOKEN: 'verify_token',
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
