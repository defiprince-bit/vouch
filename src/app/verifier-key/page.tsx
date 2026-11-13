import { VerifierKey } from './VerifierKey';

export default function VerifierKeyPage() {
  return (
    <section className="py-10">
      <h1 className="mb-2 text-3xl font-bold">Be someone&apos;s verifier</h1>
      <p className="mb-6 max-w-xl text-neutral-400">
        Connect your wallet and send your friend this key. When they finish, they&apos;ll send you a link and you approve by signing the refund in your wallet.
        You can never take their coins: you can only return them to your friend or send them to the beneficiary they chose.
      </p>
      <VerifierKey />
    </section>
  );
}
