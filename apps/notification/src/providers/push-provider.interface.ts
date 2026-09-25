import { SendResult } from './email-provider.interface';

export interface PushProvider {
	send(to: string, title: string, body: string): Promise<SendResult>;
}

export const PUSH_PROVIDER = 'PUSH_PROVIDER';
