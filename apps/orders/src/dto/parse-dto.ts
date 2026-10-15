import { RpcException } from '@nestjs/microservices';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { ValidationError, validateSync } from 'class-validator';

function collectConstraints(error: ValidationError): string[] {
	return [
		...Object.values(error.constraints ?? {}),
		...(error.children ?? []).flatMap((child) => collectConstraints(child)),
	];
}

/**
 * Orders không có ValidationPipe toàn cục nên payload TCP được kiểm ở biên handler.
 * Field lạ bị loại (whitelist); sai dữ liệu trả 400.
 */
export function parseDto<T extends object>(
	type: ClassConstructor<T>,
	raw: unknown,
): T {
	const dto = plainToInstance(type, raw);
	const errors = validateSync(dto, {
		whitelist: true,
		forbidUnknownValues: true,
	});
	if (errors.length > 0) {
		throw new RpcException({
			statusCode: 400,
			message:
				errors.flatMap(collectConstraints).join('; ') || 'Dữ liệu không hợp lệ',
		});
	}
	return dto;
}
