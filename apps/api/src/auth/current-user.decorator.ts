import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthedUser {
  id: string;
  email: string;
  /** True only on the request that first created this User row — see
   *  UsersService.findOrCreateByEmail. WalletsController uses this to seed
   *  a demo wallet exactly once per user, never again after. */
  isNew: boolean;
}

/** Only valid on routes behind ServiceAuthGuard — that's what puts
 *  request.user there in the first place. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
