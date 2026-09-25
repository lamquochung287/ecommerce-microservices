import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { ReviewController } from './review.controller';
import { CreateReviewHandler } from './commands/handlers/create-review.handler';
import { GetReviewsByProductHandler } from './queries/handlers/get-reviews-by-product.handler';
import { Review } from './entities/review.entity';
import { ORDER_TCP_CLIENT } from './order-client.constant';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';

export const CommandHandlers = [CreateReviewHandler];
export const QueryHandlers = [GetReviewsByProductHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([Review]),
		CqrsModule,
		HealthModule,
		ClientsModule.register([
			{
				name: ORDER_TCP_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.ORDER_TCP_PORT },
			},
		]),
	],
	controllers: [ReviewController],
	providers: [...CommandHandlers, ...QueryHandlers],
})
export class ReviewModule {}
