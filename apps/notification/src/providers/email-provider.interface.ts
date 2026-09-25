export interface SendResult {
	success: boolean;
	failureReason?: string;
}

export interface EmailProvider {
	send(to: string, subject: string, body: string): Promise<SendResult>;
}

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';
