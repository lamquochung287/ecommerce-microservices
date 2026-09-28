import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GatewayService } from './gateway.service';

@ApiTags('Root')
@Controller()
export class GatewayController {
	constructor(private readonly gatewayService: GatewayService) {}

	@Get()
	getHello() {
		return this.gatewayService.getHelloUser();
	}
}
