import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called on every authenticated request (see ServiceAuthGuard). Google
   * sign-in already guarantees a verified, stable email, so "does a User
   * row exist for this email" is the entire identity question here — no
   * separate signup step. First request for a new email creates the row;
   * every request after that just finds it.
   *
   * `isNew` tells the caller whether this was that first-ever request —
   * WalletsController uses it to seed a demo wallet exactly once, without
   * needing a separate "have we seeded this user" column. It's true only
   * on the create branch; every later request for the same email hits
   * findUnique and gets isNew: false.
   */
  async findOrCreateByEmail(email: string): Promise<{ user: { id: string; email: string }; isNew: boolean }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return { user: existing, isNew: false };
    const user = await this.prisma.user.create({ data: { email } });
    return { user, isNew: true };
  }
}
