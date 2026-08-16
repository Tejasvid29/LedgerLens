import type { SerializedTransaction, SerializedHolding, WalletSummary } from '@ledgerlens/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type { SerializedTransaction, SerializedHolding, WalletSummary };
export type Transaction = SerializedTransaction;
export type Wallet = WalletSummary;

/**
 * Mirrors apps/api/src/wallets/holdings.ts's HoldingIssue. Not imported from
 * there — that module belongs to the API, not the shared package, and this
 * app should only depend on the JSON shape it actually receives over the
 * wire, not reach into another workspace's internals.
 */
export interface HoldingIssue {
  chainId: number;
  tokenAddress: string | null;
  reason: string;
  detail?: string;
}

export interface HoldingsResponse {
  holdings: SerializedHolding[];
  issues: HoldingIssue[];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init });
  if (!res.ok) {
    // NestJS's default exception body is { statusCode, message, error } —
    // message is what a BadRequestException/NotFoundException actually
    // said (e.g. "Address must be a 0x-prefixed, 40-character hex
    // string."). Falling back to the HTTP status alone would throw that
    // away and show a useless "HTTP 400" instead of the real reason.
    let message = `${init?.method ?? 'GET'} ${path} failed: HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      // Response wasn't JSON (or was empty) — keep the status-based fallback.
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function fetchWallets(): Promise<WalletSummary[]> {
  return apiFetch<WalletSummary[]>('/wallets');
}

export async function fetchTransactions(walletId: string): Promise<SerializedTransaction[]> {
  return apiFetch<SerializedTransaction[]>(`/wallets/${walletId}/transactions`);
}

export async function fetchHoldings(walletId: string): Promise<HoldingsResponse> {
  return apiFetch<HoldingsResponse>(`/wallets/${walletId}/holdings`);
}

export async function createWallet(address: string, label?: string): Promise<WalletSummary> {
  return apiFetch<WalletSummary>('/wallets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, label }),
  });
}

export async function syncWallet(walletId: string): Promise<void> {
  await apiFetch(`/wallets/${walletId}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function deleteWallet(walletId: string): Promise<void> {
  await apiFetch(`/wallets/${walletId}`, { method: 'DELETE' });
}
