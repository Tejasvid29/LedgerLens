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

  // POST, not GET: this can call out to a billed LLM (a cache miss does),
  // so it reads as an action rather than an idempotent fetch, same
  // reasoning as /sync. S15 added semantic caching in front of the actual
  // spend — see InsightsService — but the endpoint's shape doesn't change
  // because of it: a cache hit is still conceptually "generate an insight
  // for this wallet", just a free one.
  @Post(':id/insight')
  @UseGuards(ServiceAuthGuard)
  async generate(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const wallet = await this.wallets.findById(id, user.id);
    if (!wallet) throw new NotFoundException('Wallet not found');

    return this.insights.generateForWallet(id, wallet);
  }
}
