import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';

// Token ClientProxy TCP của checkout; tách khỏi token của Saga cũ để hai module không đè nhau.
export const INVENTORY_CLIENT = NAME_SERVICE_TCP.INVENTORY_SERVICE;
export const PAYMENT_CLIENT = NAME_SERVICE_TCP.PAYMENT_SERVICE;
export const PRODUCT_CLIENT = NAME_SERVICE_TCP.PRODUCT_SERVICE;
export const PROMOTION_CLIENT = NAME_SERVICE_TCP.PROMOTION_SERVICE;

export const SERVICE_CALL_TIMEOUT_MS = 10000;
