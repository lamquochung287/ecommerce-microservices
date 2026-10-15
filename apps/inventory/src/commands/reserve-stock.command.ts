import { ReserveStockDto } from '../dto/inventory.dto';

export class ReserveStockCommand {
	constructor(public readonly dto: ReserveStockDto) {}
}
