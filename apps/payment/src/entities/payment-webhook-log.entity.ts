import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	Unique,
} from 'typeorm';

// Ghi lại mọi webhook callback đã xử lý theo eventId để đảm bảo idempotent — cùng 1 callback gọi lại
// nhiều lần (retry từ provider) chỉ được xử lý 1 lần.
@Entity('payment_webhook_logs')
@Unique(['eventId'])
export class PaymentWebhookLog {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 255 })
	eventId: string;

	@Column({ type: 'uuid' })
	orderId: string;

	@CreateDateColumn()
	processedAt: Date;
}
