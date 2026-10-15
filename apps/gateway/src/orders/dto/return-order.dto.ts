import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReturnOrderDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(500)
	reason: string;
}
