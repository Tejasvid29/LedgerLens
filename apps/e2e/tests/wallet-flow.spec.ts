import { test, expect } from '@playwright/test';
import { E2E_FIXTURE_ADDRESS } from '@ledgerlens/shared';

/**
 * The one end-to-end flow S17 asks for: add a wallet, sync, see
 * transactions, generate an insight. Runs entirely offline — the API is
 * spawned with CHAIN_PROVIDER=fixture and LLM_PROVIDER=stub (see
 * playwright.config.ts), so "sync" and "generate an insight" both return
 * deterministic canned data instead of calling Alchemy or OpenAI.
 *
 * Auth is pre-seeded via storageState (global-setup.ts mints a real
 * NextAuth session cookie) — this spec starts already signed in, matching
 * what a returning user's browser looks like, not what a fresh sign-in
 * looks like. The Google OAuth redirect itself isn't e2e-testable without
 * a real Google test account, and isn't what this flow is about.
 */
test('add a wallet, sync, see transactions, generate an insight', async ({ page }) => {
  await page.goto('/');

  // Confirms storageState actually worked — a broken/expired cookie would
  // redirect here instead of rendering the dashboard, and every
  // subsequent step would fail for a misleading reason if this wasn't
  // checked explicitly first.
  await expect(page).not.toHaveURL(/\/login/);

  await test.step('add the fixture wallet', async () => {
    await page.getByTestId('wallet-address-input').fill(E2E_FIXTURE_ADDRESS);
    await page.getByTestId('add-wallet-submit').click();

    // AddWalletForm navigates to ?wallet=<id> on success — the address
    // showing up in the sidebar is proof the wallet exists server-side,
    // not just that the form cleared.
    await expect(page.getByText(E2E_FIXTURE_ADDRESS, { exact: false })).toBeVisible();
  });

  await test.step('sync from chain', async () => {
    await page.getByTestId('sync-button').click();
    await expect(page.getByTestId('sync-button')).toHaveText('Sync from chain', {
      timeout: 15_000,
    });
  });

  await test.step('see transactions', async () => {
    const rows = page.getByTestId('transaction-row');
    // FixtureChainProvider returns 2 transactions each on ethereum and
    // polygon for this address — see chain/fixture-chain.provider.ts.
    await expect(rows).toHaveCount(4);

    await expect(page.getByTestId('transactions-table')).toContainText('ETH');
    await expect(page.getByTestId('transactions-table')).toContainText('USDC');
    await expect(page.getByTestId('transactions-table')).toContainText('MATIC');
    await expect(page.getByTestId('transactions-table')).toContainText('Ethereum');
    await expect(page.getByTestId('transactions-table')).toContainText('Polygon');
  });

  await test.step('generate an insight', async () => {
    await page.getByTestId('generate-insight-button').click();

    const summary = page.getByTestId('insight-summary');
    await expect(summary).toBeVisible({ timeout: 15_000 });

    // StubInsightProvider (LLM_PROVIDER=stub) assembles its summary
    // mechanically from the same holdings it was given — grounded by
    // construction, so asserting a real holding's token symbol shows up
    // is a meaningful check, not a tautology.
    const text = await summary.textContent();
    expect(text).toBeTruthy();
    expect(text).toMatch(/ETH|USDC|MATIC/);
  });
});
