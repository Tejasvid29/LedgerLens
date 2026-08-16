import { Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { WalletsService } from '../wallets/wallets.service';
import { InsightsService } from './insights.service';
import { ServiceAuthGuard } from '../auth/service-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';

@Controller('wallets')
export class InsightsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly insights: InsightsService,
  ) {}

  // POST, not GET: this calls out to an LLM on every request (no caching
  // yet — that's S15) and costs real money each time, so it reads as an
  // action rather than an idempotent fetch, same reasoning as /sync.
  @Post(':id/insight')
  @UseGuards(ServiceAuthGuard)
  async generate(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const wallet = await this.wallets.findById(id, user.id);
    if (!wallet) throw new NotFoundException('Wallet not found');

    return this.insights.generateForWallet(id, wallet);
  }
}
