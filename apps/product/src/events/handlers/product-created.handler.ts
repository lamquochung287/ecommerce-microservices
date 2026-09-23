import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { ProductCreatedEvent } from '../product-created.event';

@EventsHandler(ProductCreatedEvent)
export class ProductCreatedHandler implements IEventHandler<ProductCreatedEvent> {
	handle(event: ProductCreatedEvent) {
		console.log('Event Received: ProductCreatedEvent...', event);
		// In the future, this is where we will publish to Kafka to sync with Elasticsearch
	}
}
