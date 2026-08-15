import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { SyncService } from '../chain/sync.service';
import { CHAINS } from '../chain/chain.config';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly syncService: SyncService,
  ) {}

  @Get('chains/supported')
  supportedChains() {
    return Object.entries(CHAINS).map(([key, chain]) => ({
      key,
      chainId: chain.chainId,
      name: chain.name,
      nativeSymbol: chain.nativeSymbol,
    }));
  }

  @Get()
  list() {
    return this.wallets.list();
  }

  @Post()
  create(@Body() body: { address: string; label?: string }) {
    return this.wallets.create(body.address, body.label);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const wallet = await this.wallets.findById(id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  @Get(':id/transactions')
  async transactions(
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
  ) {
    const wallet = await this.wallets.findById(id);
    if (!wallet) throw new NotFoundException('Wallet not found');

    if (refresh === 'true') {
      await this.syncService.syncWallet(id);
    }

    return this.wallets.getTransactions(id);
  }

  @Post(':id/sync')
  async sync(
    @Param('id') id: string,
    @Body() body?: { chains?: string[] },
  ) {
    const wallet = await this.wallets.findById(id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return this.syncService.syncWallet(id, body?.chains);
  }

}
