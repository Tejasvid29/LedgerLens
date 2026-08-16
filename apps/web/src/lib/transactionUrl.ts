/**
 * Single source of truth for building a "/?..." URL that preserves the
 * current wallet/filter/sort/page state while changing one dimension of
 * it. Used by three different places that all need to agree on the same
 * query-string shape: sortable column headers (Server Component <Link>s),
 * the pagination links (Server Component), and the chain/token filter
 * selects (client island, via router.push). Keeping it in one function
 * means those three can't drift into three different param names.
 */
export interface TransactionUrlState {
  wallet?: string;
  chain?: string;
  token?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

/**
 * `overrides` values of `undefined` remove that param; every other key not
 * mentioned in `overrides` is carried over from `current` unchanged.
 */
export function buildTransactionsUrl(
  current: TransactionUrlState,
  overrides: Partial<Record<keyof TransactionUrlState, string | undefined>>,
): string {
  const merged: TransactionUrlState = { ...current, ...overrides };
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }

  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}
