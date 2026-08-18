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
  UseGuards,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { SyncService } from '../chain/sync.service';
import { CHAINS } from '../chain/chain.config';
import { queryTransactions, SortDirection, TransactionSortField } from './transactions-query';
import { ServiceAuthGuard } from '../auth/service-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';

/**
 * A well-known, real address (Vitalik Buterin's, publicly identified as
 * such) with genuine multi-chain history — read-only, no keys, same as any
 * address a real user pastes in (see CLAUDE.md rule 2). Seeded once per
 * brand-new user (see list() below) so a recruiter signing in for the
 * first time sees real holdings/transactions immediately instead of an
 * empty "No wallets yet" state, without needing to know an address to try.
 */
const DEMO_WALLET_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const DEMO_WALLET_LABEL = 'Demo — Vitalik.eth';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly syncService: SyncService,
  ) {}

  // Static reference data, not user data — left outside the auth guard.
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
  @UseGuards(ServiceAuthGuard)
  async list(@CurrentUser() user: AuthedUser) {
    if (user.isNew) {
      await this.seedDemoWallet(user.id);
    }
    return this.wallets.list(user.id);
  }

  /**
   * Runs once, ever, per user — gated by ServiceAuthGuard's isNew flag
   * (true only on the request that first created this user's row). Awaits
   * the sync (not fire-and-forget) so the very first page a new user sees
   * already has real data, not an empty "Never synced" wallet — a one-time
   * cost on account creation, covered by loading.tsx same as any other
   * slow first render. A sync failure here must not break sign-in itself:
   * the demo wallet still exists, just unsynced, same as if a real user's
   * first sync attempt failed.
   */
  private async seedDemoWallet(userId: string): Promise<void> {
    const wallet = await this.wallets.create(userId, DEMO_WALLET_ADDRESS, DEMO_WALLET_LABEL);
    try {
      await this.syncService.syncWallet(wallet.id);
    } catch {
      // Fall through — list() still returns the wallet, just unsynced.
      // The user can hit "Sync from chain" themselves, same as any wallet
      // whose first sync attempt failed.
    }
  }

  @Post()
  @UseGuards(ServiceAuthGuard)
  create(@CurrentUser() user: AuthedUser, @Body() body: { address: string; label?: string }) {
    return this.wallets.create(user.id, body.address, body.label);
  }

  @Get(':id')
  @UseGuards(ServiceAuthGuard)
  async get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const wallet = await this.wallets.findById(id, user.id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  @Get(':id/holdings')
  @UseGuards(ServiceAuthGuard)
  async holdings(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const wallet = await this.wallets.findById(id, user.id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return this.wallets.getHoldings(id);
  }

  @Get(':id/transactions')
  @UseGuards(ServiceAuthGuard)
  async transactions(
    @CurrentUser() user: AuthedUser,
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
    const wallet = await this.wallets.findById(id, user.id);
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
  @UseGuards(ServiceAuthGuard)
  async sync(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body?: { chains?: string[] },
  ) {
    const wallet = await this.wallets.findById(id, user.id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    const result = await this.syncService.syncWallet(id, body?.chains);
    await this.wallets.invalidateCache(id);
    return result;
  }

  @Delete(':id')
  @UseGuards(ServiceAuthGuard)
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    // wallets.remove() throws NotFoundException itself if the id doesn't
    // exist or isn't this user's, so no separate existence check is needed
    // here.
    await this.wallets.remove(id, user.id);
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
