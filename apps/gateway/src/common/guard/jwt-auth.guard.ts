import { CanActivate, ExecutionContext, UnauthorizedException, Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Request } from "express";
import { firstValueFrom } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        @Inject(NAME_SERVICE_TCP.USER_SERVICE)
        private readonly userClient: ClientProxy
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<Request>()
        const token = this.extractTokenFromHeader(req)

        if (!token) {
            throw new UnauthorizedException("Access token is missing")
        }

        try {
            const payload = await firstValueFrom(
                this.userClient.send({ cmd: USER_MESSAGE_PATTERN.VERIFY_TOKEN }, token)
            );
            
            if (!payload || payload.status === 'error' || payload.error) {
                throw new UnauthorizedException(payload.message || 'Invalid or expired token');
            }
            
            req['user'] = payload; // Attach user + permissions to the request
        } catch (error) {
            throw new UnauthorizedException(error.message || 'Invalid or expired token');
        }

        return true
    }

    private extractTokenFromHeader(req: Request): string | undefined {
        const [type, token] = req.headers.authorization?.split(' ') ?? []
        return type === 'Bearer' ? token : undefined
    }

}