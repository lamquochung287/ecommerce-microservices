export class ExpireReservationsCommand {
	/** Reservation chỉ bị hết hạn khi quá `expiresAt` thêm ngần này giây (cho Orders có thời gian tự release). */
	constructor(public readonly graceSeconds: number) {}
}
