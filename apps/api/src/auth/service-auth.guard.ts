import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyServiceToken } from '@ledgerlens/shared';
import { UsersService } from './users.service';

/**
 * Verifies the short-lived signed token apps/web mints per-request (see
 * packages/shared/src/serviceToken.ts) and resolves it to a User row,
 * attached as request.user for @CurrentUser() to read. A missing,
 * malformed, mis-signed, or expired token is all one outcome:
 * UnauthorizedException — this guard doesn't distinguish "which kind of
 * invalid" to the caller, since none of those distinctions are actionable
 * for anyone except an attacker.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token) throw new UnauthorizedException('Missing Authorization header.');

    const secret = this.config.getOrThrow<string>('API_AUTH_SECRET');
    const payload = verifyServiceToken(token, secret);
    if (!payload) throw new UnauthorizedException('Invalid or expired session.');

    const { user, isNew } = await this.users.findOrCreateByEmail(payload.email);
    request.user = { id: user.id, email: user.email, isNew };
    return true;
  }
}
