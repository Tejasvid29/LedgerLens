import type { SerializedTransaction, SerializedHolding, WalletSummary } from '@ledgerlens/shared';

// Server-only since S12 — no NEXT_PUBLIC_ prefix. The browser never calls
// apps/api directly anymore: every call here needs a signed service token
// (see lib/serviceAuth.ts) that only this server can mint, so every caller
// of this module is necessarily server-side (a Server Component or a
// Server Action) already.
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

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

/** Mirrors apps/api/src/wallets/transactions-query.ts's whitelist — kept as
 *  a wire-shape mirror for the same reason as HoldingIssue above. */
export type TransactionSortField = 'timestamp' | 'chainName' | 'tokenSymbol' | 'amount' | 'direction';
export type SortDirection = 'asc' | 'desc';

export interface TransactionsQuery {
  chain?: string;
  token?: string;
  sort?: TransactionSortField;
  dir?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface TransactionsResponse {
  transactions: SerializedTransaction[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    chains: { chainId: number; chainName: string }[];
    tokens: string[];
  };
}

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
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

export async function fetchWallets(token: string): Promise<WalletSummary[]> {
  return apiFetch<WalletSummary[]>('/wallets', token);
}

export async function fetchTransactions(
  token: string,
  walletId: string,
  query: TransactionsQuery = {},
): Promise<TransactionsResponse> {
  const params = new URLSearchParams();
  if (query.chain) params.set('chain', query.chain);
  if (query.token) params.set('token', query.token);
  if (query.sort) params.set('sort', query.sort);
  if (query.dir) params.set('dir', query.dir);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const qs = params.toString();
  return apiFetch<TransactionsResponse>(`/wallets/${walletId}/transactions${qs ? `?${qs}` : ''}`, token);
}

export async function fetchHoldings(token: string, walletId: string): Promise<HoldingsResponse> {
  return apiFetch<HoldingsResponse>(`/wallets/${walletId}/holdings`, token);
}

export async function createWallet(token: string, address: string, label?: string): Promise<WalletSummary> {
  return apiFetch<WalletSummary>('/wallets', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, label }),
  });
}

export async function syncWallet(token: string, walletId: string): Promise<void> {
  await apiFetch(`/wallets/${walletId}/sync`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function deleteWallet(token: string, walletId: string): Promise<void> {
  await apiFetch(`/wallets/${walletId}`, token, { method: 'DELETE' });
}
