// shipping-commands
export interface ShipmentRecipient {
	recipientName: string;
	recipientPhone: string;
	addressLine1: string;
	addressLine2?: string;
	city: string;
	province?: string;
	postalCode?: string;
	country: string;
}

export interface ShipmentItem {
	productId: string;
	quantity: number;
}

export interface CreateShipmentPayload {
	recipient: ShipmentRecipient;
	items: ShipmentItem[];
}

export type CancelShipmentPayload = Record<string, never>;

// shipping-events
export interface ShipmentCreatedPayload {
	trackingCode: string;
}

export interface ShipmentDeliveredPayload {
	deliveredAt: string;
}

export interface ShipmentFailedPayload {
	reason: string;
}
