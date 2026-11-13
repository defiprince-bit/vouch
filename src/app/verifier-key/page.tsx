import Link from 'next/link';
import { VerifierKey } from './VerifierKey';

export default function VerifierKeyPage() {
  return (
    <main className="wrap page">
      <header className="screen-head">
        <div>
          <p className="crumbs"><Link href="/">Vouch</Link> / Verifier key</p>
          <h1>Be someone’s verifier</h1>
          <p className="lede">
            Connect your wallet and send your friend this key. Later they send you a link, and you approve by signing the refund in your wallet. You can never take their coins: they only go back to your friend or to the beneficiary they chose.
          </p>
        </div>
      </header>
      <VerifierKey />
    </main>
  );
}
