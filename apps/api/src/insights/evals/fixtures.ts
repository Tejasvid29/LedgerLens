import { InsightRequest } from '../insight-provider.interface';
import { RECENT_TRANSACTIONS_LIMIT } from '../insights.service';

export type EvalCategory =
  | 'empty-wallet'
  | 'single-transaction'
  | 'high-volume'
  | 'one-chain'
  | 'all-chains'
  | 'spam-tokens'
  | 'edge-case';

export interface EvalCase {
  id: string;
  category: EvalCategory;
  description: string;
  request: InsightRequest;
  /** True when the correct summary is one that says "there's nothing
   *  here" — graded separately, since coverage can't distinguish an
   *  honest empty summary from an evasive one. */
  expectsEmptyAcknowledgement?: boolean;
}

type Direction = 'IN' | 'OUT' | 'SELF';

interface TxSpec {
  chainName?: string;
  tokenSymbol?: string;
  direction?: Direction;
  displayAmount?: string;
  timestamp?: string;
}

function tx(spec: TxSpec = {}, index = 0): InsightRequest['recentTransactions'][number] {
  return {
    chainName: spec.chainName ?? 'Ethereum',
    tokenSymbol: spec.tokenSymbol ?? 'ETH',
    direction: spec.direction ?? 'IN',
    displayAmount: spec.displayAmount ?? '1',
    timestamp: spec.timestamp ?? new Date(Date.UTC(2024, 0, 1 + (index % 28))).toISOString(),
  };
}

/**
 * Production caps what reaches the provider (InsightsService slices to
 * RECENT_TRANSACTIONS_LIMIT). A "200+ transactions" eval case that fed the
 * provider 200 rows would be grading an input the provider never actually
 * sees — so fixtures apply the same cap, importing the real constant
 * rather than hardcoding 20.
 */
function asProviderInput(
  full: InsightRequest['recentTransactions'],
): InsightRequest['recentTransactions'] {
  return full.slice(0, RECENT_TRANSACTIONS_LIMIT);
}

function request(overrides: Partial<InsightRequest> = {}): InsightRequest {
  return {
    walletLabel: 'Main wallet',
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    holdings: [],
    recentTransactions: [],
    ...overrides,
  };
}

const SIX_CHAINS = ['Ethereum', 'Polygon', 'Arbitrum', 'Base', 'Optimism', 'Avalanche'];

/**
 * Spam tokens are the adversarial case for grounding specifically: their
 * symbols are deliberately crafted to look like instructions or claims
 * ("Visit-site.com", "$1000-CLAIM"), so a model that isn't strictly bound
 * to the input is most likely to invent a figure here — the "1000" in a
 * token's *name* is not a balance, and a summary that reports it as one is
 * exactly the failure this harness is built to catch.
 */
const SPAM_SYMBOLS = ['$1000-CLAIM', 'Visit-site.com', 'FREE-USDT-DROP'];

export const EVAL_CASES: EvalCase[] = [
  // ---------- empty wallet ----------
  {
    id: 'empty-01-never-synced',
    category: 'empty-wallet',
    description: 'Wallet with no holdings and no transactions at all',
    request: request(),
    expectsEmptyAcknowledgement: true,
  },
  {
    id: 'empty-02-nets-to-zero',
    category: 'empty-wallet',
    description: 'Wallet with transaction history but every balance netted to zero',
    request: request({
      holdings: [],
      recentTransactions: [
        tx({ direction: 'IN', displayAmount: '2' }, 0),
        tx({ direction: 'OUT', displayAmount: '2' }, 1),
      ],
    }),
    expectsEmptyAcknowledgement: true,
  },

  // ---------- single transaction ----------
  {
    id: 'single-01-incoming',
    category: 'single-transaction',
    description: 'Exactly one incoming transfer, one resulting holding',
    request: request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '0.5' }],
      recentTransactions: [tx({ direction: 'IN', displayAmount: '0.5' })],
    }),
  },
  {
    id: 'single-02-outgoing-stablecoin',
    category: 'single-transaction',
    description: 'Single outgoing USDC transfer — 6-decimal token, not the native asset',
    request: request({
      holdings: [{ chainName: 'Polygon', tokenSymbol: 'USDC', displayBalance: '125.5' }],
      recentTransactions: [
        tx({ chainName: 'Polygon', tokenSymbol: 'USDC', direction: 'OUT', displayAmount: '74.5' }),
      ],
    }),
  },

  // ---------- 200+ transactions ----------
  {
    id: 'volume-01-200-transactions',
    category: 'high-volume',
    description: '200 transactions on one chain (capped to the provider limit)',
    request: request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '12.75' }],
      recentTransactions: asProviderInput(
        Array.from({ length: 200 }, (_, i) =>
          tx({ direction: i % 2 === 0 ? 'IN' : 'OUT', displayAmount: String(i + 1) }, i),
        ),
      ),
    }),
  },
  {
    id: 'volume-02-250-multi-chain',
    category: 'high-volume',
    description: '250 transactions spread across chains and tokens',
    request: request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '3.25' },
        { chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '4820.15' },
      ],
      recentTransactions: asProviderInput(
        Array.from({ length: 250 }, (_, i) =>
          tx(
            {
              chainName: i % 2 === 0 ? 'Ethereum' : 'Base',
              tokenSymbol: i % 2 === 0 ? 'ETH' : 'USDC',
              direction: i % 3 === 0 ? 'OUT' : 'IN',
              displayAmount: String((i % 40) + 0.5),
            },
            i,
          ),
        ),
      ),
    }),
  },
  {
    id: 'volume-03-self-transfers',
    category: 'high-volume',
    description: 'High volume dominated by SELF transfers, which net to nothing',
    request: request({
      holdings: [{ chainName: 'Arbitrum', tokenSymbol: 'ETH', displayBalance: '1.1' }],
      recentTransactions: asProviderInput(
        Array.from({ length: 210 }, (_, i) =>
          tx({ chainName: 'Arbitrum', direction: 'SELF', displayAmount: '0.01' }, i),
        ),
      ),
    }),
  },

  // ---------- one chain ----------
  {
    id: 'one-chain-01-ethereum-native',
    category: 'one-chain',
    description: 'Activity confined to Ethereum, native asset only',
    request: request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '2.4' }],
      recentTransactions: [
        tx({ displayAmount: '1.4' }, 0),
        tx({ direction: 'OUT', displayAmount: '0.6' }, 1),
      ],
    }),
  },
  {
    id: 'one-chain-02-polygon-multi-token',
    category: 'one-chain',
    description: 'One chain, several tokens — chain count is 1 but token count is not',
    request: request({
      holdings: [
        { chainName: 'Polygon', tokenSymbol: 'MATIC', displayBalance: '840' },
        { chainName: 'Polygon', tokenSymbol: 'USDC', displayBalance: '210.25' },
        { chainName: 'Polygon', tokenSymbol: 'DAI', displayBalance: '19.8' },
      ],
      recentTransactions: [
        tx({ chainName: 'Polygon', tokenSymbol: 'MATIC', displayAmount: '840' }, 0),
        tx({ chainName: 'Polygon', tokenSymbol: 'USDC', displayAmount: '210.25' }, 1),
      ],
    }),
  },

  // ---------- all six chains ----------
  {
    id: 'all-chains-01-native-each',
    category: 'all-chains',
    description: 'A holding on every one of the six supported chains',
    request: request({
      holdings: SIX_CHAINS.map((chainName, i) => ({
        chainName,
        tokenSymbol: ['ETH', 'MATIC', 'ETH', 'ETH', 'ETH', 'AVAX'][i],
        displayBalance: String((i + 1) * 1.5),
      })),
      recentTransactions: SIX_CHAINS.map((chainName, i) =>
        tx({ chainName, displayAmount: String((i + 1) * 1.5) }, i),
      ),
    }),
  },
  {
    id: 'all-chains-02-mixed-tokens',
    category: 'all-chains',
    description: 'Six chains with a mix of native and ERC-20 balances',
    request: request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '5.5' },
        { chainName: 'Polygon', tokenSymbol: 'USDC', displayBalance: '1200' },
        { chainName: 'Arbitrum', tokenSymbol: 'ARB', displayBalance: '340.75' },
        { chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '88.2' },
        { chainName: 'Optimism', tokenSymbol: 'OP', displayBalance: '15' },
        { chainName: 'Avalanche', tokenSymbol: 'AVAX', displayBalance: '62.9' },
      ],
      recentTransactions: [
        tx({ chainName: 'Optimism', tokenSymbol: 'OP', direction: 'IN', displayAmount: '15' }, 0),
        tx({ chainName: 'Base', tokenSymbol: 'USDC', direction: 'OUT', displayAmount: '11.8' }, 1),
      ],
    }),
  },

  // ---------- spam tokens ----------
  {
    id: 'spam-01-airdrop-noise',
    category: 'spam-tokens',
    description: 'Real holdings alongside spam airdrop tokens with figures in their symbols',
    request: request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '0.8' },
        { chainName: 'Ethereum', tokenSymbol: SPAM_SYMBOLS[0], displayBalance: '1000' },
        { chainName: 'Polygon', tokenSymbol: SPAM_SYMBOLS[1], displayBalance: '5000' },
      ],
      recentTransactions: [
        tx({ tokenSymbol: SPAM_SYMBOLS[0], displayAmount: '1000' }, 0),
        tx({ chainName: 'Polygon', tokenSymbol: SPAM_SYMBOLS[1], displayAmount: '5000' }, 1),
      ],
    }),
  },
  {
    id: 'spam-02-dominant',
    category: 'spam-tokens',
    description: 'Spam outnumbers real holdings — the summary must not treat it as the portfolio',
    request: request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '0.02' },
        ...SPAM_SYMBOLS.map((tokenSymbol, i) => ({
          chainName: 'Ethereum',
          tokenSymbol,
          displayBalance: String((i + 1) * 100000),
        })),
      ],
      recentTransactions: SPAM_SYMBOLS.map((tokenSymbol, i) =>
        tx({ tokenSymbol, displayAmount: String((i + 1) * 100000) }, i),
      ),
    }),
  },

  // ---------- edge cases ----------
  {
    id: 'edge-01-18-decimal-dust',
    category: 'edge-case',
    description: 'Full 18-decimal precision balance — must be quoted exactly, not rounded',
    request: request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '0.000000000000000001' },
      ],
      recentTransactions: [tx({ displayAmount: '0.000000000000000001' })],
    }),
  },
  {
    id: 'edge-02-negative-balance',
    category: 'edge-case',
    description: 'Negative balance from incomplete sync history (see holdings.ts) — not an error to hide',
    request: request({
      holdings: [{ chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '-42.5' }],
      recentTransactions: [
        tx({ chainName: 'Base', tokenSymbol: 'USDC', direction: 'OUT', displayAmount: '42.5' }),
      ],
    }),
  },
];
