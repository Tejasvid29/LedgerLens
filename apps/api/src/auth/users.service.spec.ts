import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService.findOrCreateByEmail', () => {
  it('returns the existing user without creating one', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@example.com' }),
        create: jest.fn(),
      },
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    const user = await service.findOrCreateByEmail('a@example.com');

    expect(user).toEqual({ id: 'u1', email: 'a@example.com' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a new user when none exists for the email', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'u2', email: 'new@example.com' }),
      },
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    const user = await service.findOrCreateByEmail('new@example.com');

    expect(prisma.user.create).toHaveBeenCalledWith({ data: { email: 'new@example.com' } });
    expect(user).toEqual({ id: 'u2', email: 'new@example.com' });
  });
});
