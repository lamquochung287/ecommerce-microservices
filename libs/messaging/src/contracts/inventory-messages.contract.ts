// inventory-commands: CommitInventory / ReleaseInventory / RestockInventory không có payload (orderId ở envelope).
export type InventoryCommandPayload = Record<string, never>;

// inventory-events
export type InventoryCommittedPayload = Record<string, never>;

export interface InventoryCommitFailedPayload {
	reason: string;
}
