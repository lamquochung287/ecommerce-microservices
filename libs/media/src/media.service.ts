import { Inject, Injectable } from '@nestjs/common';
import { Client } from 'minio';
import { randomUUID } from 'crypto';
import { MINIO_CLIENT, MEDIA_BUCKET } from './media.constant';

@Injectable()
export class MediaService {
	constructor(@Inject(MINIO_CLIENT) private readonly minioClient: Client) {}

	async ensureBucketExists(bucket: string) {
		const exists = await this.minioClient
			.bucketExists(bucket)
			.catch(() => false);
		if (!exists) {
			await this.minioClient.makeBucket(bucket);
		}
	}

	// Trả về object path (không phải URL đầy đủ) — Gateway/service gọi tự ghép với public endpoint khi cần hiển thị.
	async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
		const objectName = `${folder}/${randomUUID()}-${file.originalname}`;
		await this.minioClient.putObject(
			MEDIA_BUCKET,
			objectName,
			file.buffer,
			file.size,
			{
				'Content-Type': file.mimetype,
			},
		);
		return objectName;
	}

	async getPresignedUrl(
		objectName: string,
		expirySeconds = 3600,
	): Promise<string> {
		return this.minioClient.presignedGetObject(
			MEDIA_BUCKET,
			objectName,
			expirySeconds,
		);
	}
}
