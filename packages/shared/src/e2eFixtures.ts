/**
 * Single source of truth for the e2e fixture wallet, shared across two
 * workspaces that otherwise have no reason to import from each other:
 *
 *   apps/api's FixtureChainProvider (chain/fixture-chain.provider.ts)
 *     returns canned transfers keyed on this exact address — every other
 *     address still gets an empty history, so this is deliberately the
 *     *only* address the fixture provider knows about.
 *
 *   apps/e2e's Playwright suite pastes this address into the "Add wallet"
 *     form and asserts against the same canned data.
 *
 * Keeping one literal here instead of two independently-typed literals in
 * each workspace is the whole point — a typo in either place would silently
 * desync "what the test expects" from "what the fixture returns".
 */
export const E2E_FIXTURE_ADDRESS = '0xe2e0000000000000000000000000000000000e2e';

/** Not a real Google account — this is the identity baked into the
 *  NextAuth session cookie apps/e2e's global-setup mints directly (see
 *  packages/shared/src/serviceToken.ts for the analogous server-side
 *  token), bypassing the real Google OAuth flow entirely for tests. */
export const E2E_TEST_EMAIL = 'e2e@ledgerlens.test';
