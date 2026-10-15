import {
	Body,
	Controller,
	Get,
	Param,
	ParseUUIDPipe,
	Post,
	UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetUser } from '../common/decorator/get-user.decorator';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { ReturnOrderDto } from './dto/return-order.dto';

// Chỉ JwtAuthGuard (không PermissionGuard): đây là thao tác của chính chủ đơn. Gateway chỉ truyền
// userId lấy từ token; Orders so khớp chủ sở hữu và trả 404 nếu đơn không thuộc user.
@ApiTags('Customer Orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class CustomerOrdersController {
	constructor(private readonly ordersService: OrdersService) {}

	@Get(':id/pay')
	getPaymentLink(
		@GetUser('userId') userId: string,
		@Param('id', new ParseUUIDPipe()) id: string,
	) {
		return this.ordersService.getPaymentLink(id, userId);
	}

	@Post(':id/cancel')
	cancelOrder(
		@GetUser('userId') userId: string,
		@Param('id', new ParseUUIDPipe()) id: string,
	) {
		return this.ordersService.cancelOrder(id, userId);
	}

	@Post(':id/return')
	requestReturn(
		@GetUser('userId') userId: string,
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() dto: ReturnOrderDto,
	) {
		return this.ordersService.requestReturn(id, userId, dto.reason);
	}
}
