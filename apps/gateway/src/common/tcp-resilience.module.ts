import { Global, Module } from '@nestjs/common';
import { TcpResilienceService } from './tcp-resilience.service';

@Global()
@Module({
	providers: [TcpResilienceService],
	exports: [TcpResilienceService],
})
export class TcpResilienceModule {}
