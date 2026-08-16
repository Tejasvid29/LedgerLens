import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// Two separate env files, same reasoning both places load them from in the
// real apps: root .env has DATABASE_URL (global-setup/teardown's DB
// cleanup needs it), apps/web/.env.local has NEXTAUTH_SECRET (global-setup
// needs it to mint a session cookie apps/web will actually trust).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../web/.env.local') });

const REPO_ROOT = path.resolve(__dirname, '../..');
const STORAGE_STATE = path.resolve(__dirname, '.auth/storageState.json');

export default defineConfig({
  testDir: './tests',
  // One flow, one shared Postgres — parallel workers would race each other
  // over the same e2e wallet rows. Not worth per-worker DB isolation for a
  // single spec.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    storageState: STORAGE_STATE,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Both apps run as their normal `dev` servers — not a production build.
  // Sandboxed/CI environments here already proved `next build` needs
  // network access (Google Fonts) that isn't guaranteed everywhere `next
  // dev` is; e2e is testing app behavior, not the production bundler, so
  // dev mode is the more portable choice.
  webServer: [
    {
      command: 'npm run dev -w @ledgerlens/api',
      cwd: REPO_ROOT,
      url: 'http://localhost:3001/wallets/chains/supported',
      // Deliberately never reused, even locally: an already-running dev
      // server (e.g. from `npm run dev` in another terminal) would not
      // have CHAIN_PROVIDER=fixture/LLM_PROVIDER=stub set, and this suite
      // would silently start hitting real Alchemy/OpenAI instead of
      // failing loudly. If port 3001 is already bound, this errors out
      // instead — stop the other server first.
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        // The whole reason this e2e suite is deterministic and free: no
        // live Alchemy calls, no billed OpenAI calls. See
        // chain/fixture-chain.provider.ts and insights/stub-insight
        // .provider.ts. Set here, at spawn time, so root .env's real
        // LLM_PROVIDER=openai is never touched — dotenv only fills in
        // values that aren't already in process.env.
        CHAIN_PROVIDER: 'fixture',
        LLM_PROVIDER: 'stub',
      } as Record<string, string>,
    },
    {
      command: 'npm run dev -w @ledgerlens/web',
      cwd: REPO_ROOT,
      url: 'http://localhost:3000/login',
      // Same reasoning as the API server above — consistency matters more
      // than the convenience of reusing an already-running instance.
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
