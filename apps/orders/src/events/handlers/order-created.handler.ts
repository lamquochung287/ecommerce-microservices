import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderCreatedEvent } from '../order-created.event';

@EventsHandler(OrderCreatedEvent)
export class OrderCreatedHandler implements IEventHandler<OrderCreatedEvent> {
	handle(event: OrderCreatedEvent) {
		console.log('Event Received: OrderCreatedEvent...', event);
	}
}
