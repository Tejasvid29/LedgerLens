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
   */
  async findOrCreateByEmail(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;
    return this.prisma.user.create({ data: { email } });
  }
}
