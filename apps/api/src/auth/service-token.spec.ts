import { signServiceToken, verifyServiceToken } from '@ledgerlens/shared';

const SECRET = 'test-secret';

describe('signServiceToken / verifyServiceToken', () => {
  it('round-trips a valid token', () => {
    const token = signServiceToken({ sub: 'u1', email: 'a@example.com' }, SECRET);
    const payload = verifyServiceToken(token, SECRET);

    expect(payload).toMatchObject({ sub: 'u1', email: 'a@example.com' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signServiceToken({ sub: 'u1', email: 'a@example.com' }, SECRET);

    expect(verifyServiceToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload even if the signature format still parses', () => {
    const token = signServiceToken({ sub: 'u1', email: 'a@example.com' }, SECRET);
    const [body, signature] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ sub: 'attacker', email: 'x@x.com', iat: Math.floor(Date.now() / 1000) })).toString('base64url');

    expect(verifyServiceToken(`${tamperedBody}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    expect(verifyServiceToken('not-a-token', SECRET)).toBeNull();
    expect(verifyServiceToken('', SECRET)).toBeNull();
    expect(verifyServiceToken('a.b.c', SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_700_000_000_000);
    const token = signServiceToken({ sub: 'u1', email: 'a@example.com' }, SECRET);

    nowSpy.mockReturnValue(1_700_000_000_000 + 61_000); // 61s later — past the 60s window
    expect(verifyServiceToken(token, SECRET)).toBeNull();

    nowSpy.mockRestore();
  });

  it('rejects a token from the future (clock skew / replay guard)', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_700_000_000_000);
    const token = signServiceToken({ sub: 'u1', email: 'a@example.com' }, SECRET);

    nowSpy.mockReturnValue(1_700_000_000_000 - 5_000); // verifying 5s "before" it was issued
    expect(verifyServiceToken(token, SECRET)).toBeNull();

    nowSpy.mockRestore();
  });
});
