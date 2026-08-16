import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  NotFoundException,
  Query,
  HttpCode,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { SyncService } from '../chain/sync.service';
import { CHAINS } from '../chain/chain.config';
import { queryTransactions, SortDirection, TransactionSortField } from './transactions-query';

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

  @Get(':id/holdings')
  async holdings(@Param('id') id: string) {
    const wallet = await this.wallets.findById(id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return this.wallets.getHoldings(id);
  }

  @Get(':id/transactions')
  async transactions(
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
    @Query('baseline') baseline?: string,
    @Query('nocache') nocache?: string,
    @Query('chain') chain?: string,
    @Query('token') token?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const wallet = await this.wallets.findById(id);
    if (!wallet) throw new NotFoundException('Wallet not found');

    const skipCache = nocache === 'true' || baseline === 'true';

    // baseline=true: sync from Alchemy on every load — the "before" measurement path
    if (refresh === 'true' || baseline === 'true') {
      await this.syncService.syncWallet(id);
      await this.wallets.invalidateCache(id);
    }

    // Cache holds one canonical per-wallet list (see WalletsService); filter/
    // sort/pagination apply after, in memory, so this doesn't multiply cache
    // keys per query-param combination. Omitting chain/token/page/pageSize
    // reproduces the pre-S11 response set exactly (page 1, pageSize 500,
    // sorted by timestamp desc) — the S8 benchmark script's requests are
    // unaffected beyond the response now being wrapped in an envelope.
    const all = await this.wallets.getTransactions(id, { skipCache });

    return queryTransactions(all, {
      chainId: parseIntParam(chain),
      tokenSymbol: token || undefined,
      // queryTransactions validates these itself and falls back to sane
      // defaults for anything unrecognized — this cast just satisfies TS at
      // the boundary where an arbitrary query string enters typed code.
      sort: sort as TransactionSortField | undefined,
      dir: dir as SortDirection | undefined,
      page: parseIntParam(page),
      pageSize: parseIntParam(pageSize),
    });
  }

  @Post(':id/sync')
  async sync(
    @Param('id') id: string,
    @Body() body?: { chains?: string[] },
  ) {
    const wallet = await this.wallets.findById(id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    const result = await this.syncService.syncWallet(id, body?.chains);
    await this.wallets.invalidateCache(id);
    return result;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    // wallets.remove() throws NotFoundException itself if the id doesn't
    // exist, so no separate existence check is needed here.
    await this.wallets.remove(id);
  }
}

/** Undefined (not NaN) for a missing or non-numeric query param — treated
 *  as "no filter/no override" by queryTransactions, rather than silently
 *  filtering everything out on a malformed value. */
function parseIntParam(value?: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
