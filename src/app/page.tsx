import Link from 'next/link';
import { ConnectWallet } from '@/components/ConnectWallet';
import { Ticket } from '@/components/Ticket';

export default function Home() {
  return (
    <main className="wrap page">
      <section className="hero">
        <div>
          <p className="eyebrow">Bitcoin Cash · a CashScript covenant</p>
          <h1>Lock a little cash on a habit you’ll keep.</h1>
          <p className="lede">
            If you keep your word, the contract sends the coins back. If you break it, or the deadline passes, they go to the person you named.
          </p>
          <div className="hero-cta">
            <ConnectWallet size="lg" />
            <Link className="btn btn-ghost btn-lg" href="/create">Create a pledge</Link>
            <Link className="btn btn-ghost btn-lg" href="/pledges">My pledges</Link>
          </div>
        </div>
        <aside className="hero-ticket" aria-label="Example pledge ticket">
          <Ticket
            tag="Example only — not a live pledge"
            stamp="Active"
            habit="Run three mornings this week."
            stake="0.05 BCH"
            deadline="27 Nov 2026, 23:59 WAT"
            verifier="Vouch demo"
            beneficiary="Chidi"
            beneficiaryAddr="bitcoincash:p…"
            keepCopy="Coins return to you, after you sign and the verifier signs the refund in their wallet."
            breakCopy="The 0.05 BCH is paid to Chidi. Same if time runs out."
          />
        </aside>
      </section>

      <section className="steps" aria-label="How it works">
        <article className="step">
          <p className="step-num">01 Stake</p>
          <h2>Lock the coins</h2>
          <p>Name the habit, the amount in BCH, a deadline, who verifies (the Vouch demo, or a friend), and the person who is paid if you slip.</p>
        </article>
        <article className="step">
          <p className="step-num">02 Verify</p>
          <h2>Get it signed</h2>
          <p>You sign, then the verifier signs the refund transaction in their wallet. The contract will not refund on your signature alone.</p>
        </article>
        <article className="step">
          <p className="step-num">03 Keep or forfeit</p>
          <h2>Coins follow the outcome</h2>
          <p>Keep it, and the BCH returns to you. Break it, or miss the deadline, and the beneficiary is paid.</p>
        </article>
      </section>
    </main>
  );
}
