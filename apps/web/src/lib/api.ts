const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Transaction {
  id: string;
  chainId: number;
  chainName: string;
  hash: string;
  blockNumber: string;
  timestamp: string;
  direction: 'IN' | 'OUT' | 'SELF';
  rawValue: string;
  decimals: number;
  displayAmount: string;
  tokenSymbol: string;
  tokenAddress: string | null;
  status: string;
}

export interface Wallet {
  id: string;
  address: string;
  label: string | null;
  lastSyncedAt: string | null;
  _count?: { transactions: number };
}

export async function fetchWallets(): Promise<Wallet[]> {
  const res = await fetch(`${API_URL}/wallets`, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error('Failed to fetch wallets');
  return res.json();
}

export async function fetchTransactions(
  walletId: string,
  refresh = false,
): Promise<Transaction[]> {
  const url = `${API_URL}/wallets/${walletId}/transactions${refresh ? '?refresh=true' : ''}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function createWallet(address: string, label?: string): Promise<Wallet> {
  const res = await fetch(`${API_URL}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, label }),
  });
  if (!res.ok) throw new Error('Failed to create wallet');
  return res.json();
}

export async function syncWallet(walletId: string): Promise<void> {
  const res = await fetch(`${API_URL}/wallets/${walletId}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to sync wallet');
}
