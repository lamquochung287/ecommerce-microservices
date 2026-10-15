import {
	Controller,
	Get,
	HttpException,
	HttpStatus,
	NotFoundException,
	Param,
	ParseEnumPipe,
	ParseUUIDPipe,
	Post,
	Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { PaymentService } from './payment.service';
import {
	renderSimulatorErrorPage,
	renderSimulatorPage,
	renderSimulatorResultPage,
	SimulatorIntent,
} from './simulator-page';

enum SimulatorResult {
	SUCCESS = 'success',
	FAIL = 'fail',
}

interface SimulatedWebhook {
	payload: Record<string, unknown>;
	signature: string;
}

// Trình duyệt không gửi được x-api-key nên route này được miễn ở middleware (xem gateway.module).
// Đổi lại: tắt hẳn khi production, và kết quả vẫn đi qua webhook có chữ ký HMAC do Payment kiểm tra.
@ApiExcludeController()
@Controller('simulator/pay')
export class PaymentSimulatorController {
	constructor(
		private readonly paymentService: PaymentService,
		private readonly configService: ConfigService,
	) {}

	@Get(':intentId')
	async showPage(
		@Param('intentId', new ParseUUIDPipe()) intentId: string,
		@Res() res: Response,
	) {
		this.assertEnabled();
		try {
			const intent = (await this.paymentService.getIntent(
				intentId,
			)) as SimulatorIntent;
			res.status(HttpStatus.OK).type('html').send(renderSimulatorPage(intent));
		} catch (error) {
			this.sendError(res, error);
		}
	}

	@Post(':intentId/:result')
	async submit(
		@Param('intentId', new ParseUUIDPipe()) intentId: string,
		@Param('result', new ParseEnumPipe(SimulatorResult))
		result: SimulatorResult,
		@Res() res: Response,
	) {
		this.assertEnabled();
		try {
			// Payment dựng và ký payload; Gateway chuyển nguyên object (không đổi thứ tự key) vào đường webhook.
			const webhook = (await this.paymentService.simulatePayment(
				intentId,
				result,
			)) as SimulatedWebhook;
			const outcome = (await this.paymentService.handleWebhook({
				payload: webhook.payload,
				signature: webhook.signature,
			})) as { alreadyProcessed?: boolean } | undefined;
			res
				.status(HttpStatus.OK)
				.type('html')
				.send(
					renderSimulatorResultPage(result, outcome?.alreadyProcessed === true),
				);
		} catch (error) {
			this.sendError(res, error);
		}
	}

	// Pipe (UUID/enum) chạy trước handler nên với production tham số sai vẫn nhận 400; chỉ lộ "route tồn tại",
	// không lộ dữ liệu. Handler luôn 404 trước khi gọi bất kỳ service nào.
	private assertEnabled() {
		if (this.configService.get<string>('NODE_ENV') === 'production') {
			throw new NotFoundException();
		}
	}

	private sendError(res: Response, error: unknown) {
		const status =
			error instanceof HttpException
				? error.getStatus()
				: HttpStatus.INTERNAL_SERVER_ERROR;
		const message =
			error instanceof HttpException ? error.message : 'Lỗi không xác định';
		res.status(status).type('html').send(renderSimulatorErrorPage(message));
	}
}
