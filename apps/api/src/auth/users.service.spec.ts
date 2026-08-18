import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService.findOrCreateByEmail', () => {
  it('returns the existing user without creating one, and isNew: false', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@example.com' }),
        create: jest.fn(),
      },
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    const result = await service.findOrCreateByEmail('a@example.com');

    expect(result).toEqual({ user: { id: 'u1', email: 'a@example.com' }, isNew: false });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a new user when none exists for the email, and reports isNew: true', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'u2', email: 'new@example.com' }),
      },
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    const result = await service.findOrCreateByEmail('new@example.com');

    expect(prisma.user.create).toHaveBeenCalledWith({ data: { email: 'new@example.com' } });
    expect(result).toEqual({ user: { id: 'u2', email: 'new@example.com' }, isNew: true });
  });
});
