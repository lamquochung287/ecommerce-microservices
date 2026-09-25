import { AdjustStockDto } from '../dto/product-variant.dto';

export class AdjustStockCommand {
	constructor(public readonly dto: AdjustStockDto) {}
}
