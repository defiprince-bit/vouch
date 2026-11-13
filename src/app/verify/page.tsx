import { VerifyPledge } from './VerifyPledge';

export default function VerifyPage() {
  return (
    <section className="py-10">
      <h1 className="mb-2 text-3xl font-bold">Verify a pledge</h1>
      <p className="mb-6 text-neutral-400">Your friend staked BCH on a promise and named you as their verifier.</p>
      <VerifyPledge />
    </section>
  );
}
