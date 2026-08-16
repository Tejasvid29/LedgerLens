'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getAuthedSession } from './serviceAuth';
import {
  createWallet,
  syncWallet,
  deleteWallet,
  generateInsight,
  type WalletSummary,
  type InsightSummary,
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

export async function createWalletAction(address: string, label?: string): Promise<WalletSummary> {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  const wallet = await createWallet(session.token, address, label);
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

// No revalidatePath: unlike the mutations above, an insight isn't stored
// wallet state the rest of the page reads — it's a one-off response the
// caller (InsightPanel) holds in its own client state and displays
// directly. Refreshing the page would just throw it away.
export async function generateInsightAction(walletId: string): Promise<InsightSummary> {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  return generateInsight(session.token, walletId);
}
