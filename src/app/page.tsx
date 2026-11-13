import Link from 'next/link';

export default function Home() {
  return (
    <section className="py-16">
      <p className="mb-3 text-sm uppercase tracking-widest text-emerald-400">Bitcoin Cash covenant · habit escrow</p>
      <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
        Stake BCH on a habit. Keep the streak, the covenant returns your coins. Break it, the stake pays someone else.
      </h1>
      <div className="mt-8 flex gap-3">
        <Link href="/create" className="rounded-full bg-emerald-500 px-5 py-3 font-semibold text-black">Make a pledge</Link>
        <Link href="/pledges" className="rounded-full border border-neutral-700 px-5 py-3">My pledges</Link>
      </div>
      <div className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          ['Keep', 'You and your verifier both sign. The contract only lets the coins go back to you.'],
          ['Break', 'You admit it, or your verifier calls it. The stake can only go to your beneficiary.'],
          ['Deadline', 'Nobody signed a keep in time? Anyone can push the stake to the beneficiary. No one has to be online.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
            <h3 className="mb-2 font-semibold text-emerald-300">{t}</h3>
            <p className="text-sm text-neutral-300">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
