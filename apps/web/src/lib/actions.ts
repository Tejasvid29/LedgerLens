'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getAuthedSession } from './serviceAuth';
import {
  createWallet,
  syncWallet,
  deleteWallet,
  generateInsight,
  fetchTransactions,
  type WalletSummary,
  type InsightSummary,
  type TransactionsQuery,
  type TransactionsResponse,
} from './api';

/**
 * Client components (AddWalletForm, SyncControls, RemoveWalletButton)
 * cannot call apps/api directly anymore — doing so would mean either
 * exposing API_AUTH_SECRET to the browser (defeats its purpose) or
 * shipping an unsigned request apps/api would have to trust blindly.
 * These Server Actions run on this server, where getAuthedSession() can
 * mint a token safely, and are invoked from client components as if they
 * were ordinary async functions — Next.js handles the RSC round-trip.
 */

/**
 * Creates the wallet, then syncs it immediately — one user action (paste,
 * submit) instead of two (add, then separately remember to hit "Sync from
 * chain"). This is why adding a wallet used to appear to "need a refresh":
 * the wallet existed but had never been synced, so its holdings/
 * transactions were genuinely empty until a manual sync. Awaiting both
 * here means AddWalletForm's router.refresh() (after this resolves) shows
 * real data on the first render — at the cost of the submit button staying
 * in its loading state for as long as the sync takes (a handful of seconds
 * to ~30s across 6 chains, mostly Alchemy rate-limit backoff — see
 * SyncService). A sync failure here doesn't fail wallet creation: the
 * wallet still exists, just unsynced, exactly like a failed manual sync
 * would leave it — the caller can retry with "Sync from chain".
 */
export async function createWalletAction(address: string, label?: string): Promise<WalletSummary> {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  const wallet = await createWallet(session.token, address, label);
  try {
    await syncWallet(session.token, wallet.id);
  } catch {
    // Wallet creation still succeeds — see doc comment above.
  }
  revalidatePath('/');
  return wallet;
}

export async function syncWalletAction(walletId: string): Promise<void> {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  await syncWallet(session.token, walletId);
  revalidatePath('/');
}

export async function deleteWalletAction(walletId: string): Promise<void> {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  await deleteWallet(session.token, walletId);
  revalidatePath('/');
}

/**
 * Backs TransactionsList's "Load more" button (see components/
 * TransactionsList.tsx) — a client component can't call apps/api directly
 * (same reasoning as every other action here: API_AUTH_SECRET stays
 * server-side), so each additional page of 20 rows is fetched through this
 * action instead of a route-driven full-page Server Component re-fetch.
 * No revalidatePath: this doesn't change stored state, just reads more of
 * it — nothing else on the page depends on how many pages have been
 * loaded client-side.
 */
export async function loadMoreTransactionsAction(
  walletId: string,
  query: TransactionsQuery,
): Promise<TransactionsResponse> {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  return fetchTransactions(session.token, walletId, query);
}

// No revalidatePath: unlike the mutations above, an insight isn't stored
// wallet state the rest of the page reads — it's a one-off response the
// caller (InsightPanel) holds in its own client state and displays
// directly. Refreshing the page would just throw it away.
export async function generateInsightAction(walletId: string): Promise<InsightSummary> {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  return generateInsight(session.token, walletId);
}
