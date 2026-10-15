import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StockRow } from '../../domain/reservation.service';
import { AdjustStockCommand } from '../adjust-stock.command';

/**
 * Điều chỉnh tồn tay (nhập/xuất): upsert dòng kho rồi khoá và cộng `delta`.
 * Không cho onHand < reserved (sẽ làm hàng đã giữ cho đơn bị âm) hoặc < 0 -> 409.
 */
@CommandHandler(AdjustStockCommand)
export class AdjustStockHandler implements ICommandHandler<AdjustStockCommand> {
	constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

	execute(command: AdjustStockCommand) {
		const { productId, delta } = command.dto;
		const variantId = command.dto.variantId ?? null;
		return this.dataSource.transaction(async (manager) => {
			await manager.query(
				`INSERT INTO "stock_items" ("productId", "variantId", "onHand") VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
				[productId, variantId],
			);
			const rows: StockRow[] = await manager.query(
				`SELECT "id", "productId", "variantId", "onHand", "reserved" FROM "stock_items"
				 WHERE "productId" = $1 AND "variantId" IS NOT DISTINCT FROM $2 FOR UPDATE`,
				[productId, variantId],
			);
			const row = rows[0];
			const next = row.onHand + delta;
			if (next < 0 || next < row.reserved) {
				// Throw trong transaction nên dòng vừa upsert (nếu mới tạo) cũng được rollback.
				throw new RpcException({
					statusCode: 409,
					message: `Tồn kho không đủ để điều chỉnh: onHand=${row.onHand}, reserved=${row.reserved}, delta=${delta}`,
					error: 'Conflict',
				});
			}
			await manager.query(
				`UPDATE "stock_items" SET "onHand" = $1, "updatedAt" = now() WHERE "id" = $2`,
				[next, row.id],
			);
			return {
				productId,
				variantId,
				onHand: next,
				reserved: row.reserved,
				available: next - row.reserved,
			};
		});
	}
}
