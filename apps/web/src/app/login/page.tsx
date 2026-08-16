import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) redirect('/');

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm border border-rule bg-white p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Ledgerlens</h1>
        <p className="mt-1 text-sm text-ink/60">Multi-chain portfolio, one ledger.</p>

        <div className="mt-6">
          <GoogleSignInButton />
        </div>

        <p className="mt-4 text-xs text-ink/40">
          Read-only. Ledgerlens never asks for a private key or signature — sign in identifies
          you, not your wallet.
        </p>
      </div>
    </div>
  );
}
