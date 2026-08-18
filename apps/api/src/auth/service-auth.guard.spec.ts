import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { signServiceToken } from '@ledgerlens/shared';
import { ServiceAuthGuard } from './service-auth.guard';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

const SECRET = 'guard-test-secret';

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  const request = { headers, user: undefined as unknown };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ServiceAuthGuard', () => {
  let config: { getOrThrow: jest.Mock };
  let users: { findOrCreateByEmail: jest.Mock };
  let guard: ServiceAuthGuard;

  beforeEach(() => {
    config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };
    users = {
      findOrCreateByEmail: jest
        .fn()
        .mockResolvedValue({ user: { id: 'u1', email: 'a@example.com' }, isNew: false }),
    };
    guard = new ServiceAuthGuard(config as unknown as ConfigService, users as unknown as UsersService);
  });

  it('rejects a request with no Authorization header', async () => {
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
    expect(users.findOrCreateByEmail).not.toHaveBeenCalled();
  });

  it('rejects a header that is not a Bearer token', async () => {
    await expect(guard.canActivate(makeContext({ authorization: 'Basic abc' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an invalid/unverifiable token', async () => {
    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer not-a-real-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different secret than this guard checks against', async () => {
    const token = signServiceToken({ sub: 'a@example.com', email: 'a@example.com' }, 'a-different-secret');

    await expect(guard.canActivate(makeContext({ authorization: `Bearer ${token}` }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid token, resolves the user via UsersService, and attaches it to the request', async () => {
    const token = signServiceToken({ sub: 'a@example.com', email: 'a@example.com' }, SECRET);
    const request = { headers: { authorization: `Bearer ${token}` }, user: undefined as unknown };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(users.findOrCreateByEmail).toHaveBeenCalledWith('a@example.com');
    expect(request.user).toEqual({ id: 'u1', email: 'a@example.com', isNew: false });
  });

  it('attaches isNew: true when UsersService reports a first-ever request for this email', async () => {
    users.findOrCreateByEmail.mockResolvedValue({ user: { id: 'u2', email: 'b@example.com' }, isNew: true });
    const token = signServiceToken({ sub: 'b@example.com', email: 'b@example.com' }, SECRET);
    const request = { headers: { authorization: `Bearer ${token}` }, user: undefined as unknown };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    await guard.canActivate(context);

    expect(request.user).toEqual({ id: 'u2', email: 'b@example.com', isNew: true });
  });
});
