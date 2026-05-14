import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class GatewayService {
	constructor(
		@Inject('USER_SERVICE') private readonly userServiceClient: ClientProxy,
	) {}

	getHelloUser() {
		return this.userServiceClient.send({ cmd: 'get_hello_user' }, {});
	}
}
