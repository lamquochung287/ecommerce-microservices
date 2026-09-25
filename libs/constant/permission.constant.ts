export enum Action {
	NONE = 0,
	CREATE = 1 << 0, // 1
	READ = 1 << 1,   // 2
	UPDATE = 1 << 2, // 4
	DELETE = 1 << 3, // 8
	ALL = ~(~0 << 4) // 15
}

export enum ModuleName {
	USER = 1 << 4,
	PRODUCT = 1 << 5,
	ORDER = 1 << 6,
	CAMPAIGN = 1 << 7,
	PAYMENT = 1 << 8,
	REVIEW = 1 << 9,
	PROMOTION = 1 << 10,
}

// Example: ModuleName.PRODUCT | Action.READ
// When checking: (userPermissions & requiredPermission) === requiredPermission
