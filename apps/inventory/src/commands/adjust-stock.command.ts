import { AdjustStockDto } from '../dto/inventory.dto';

export class AdjustStockCommand {
	constructor(public readonly dto: AdjustStockDto) {}
}
