import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { PaymentService } from './payment.service';

@ApiTags('Payments')
@Controller('payments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PaymentController {
	constructor(private readonly paymentService: PaymentService) {}

	@Get(':orderId/transaction')
	@RequirePermission(ModuleName.PAYMENT, Action.READ)
	getTransaction(@Param('orderId') orderId: string) {
		return this.paymentService.getTransaction(orderId);
	}
}
