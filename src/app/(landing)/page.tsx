import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Newsreader } from 'next/font/google';
import { ConnectWallet } from '@/components/ConnectWallet';
import { NetworkBadge, NetworkName } from '@/components/NetworkBadge';
import { REPO_URL } from '@/lib/config';
import { LandingRoot } from './LandingRoot';
import './landing.css';

// Vouch landing v2 (design/mocks/landing.html). Every landing rule is .vl- prefixed or scoped
// under .is-landing; motion + the meadow canvas live in LandingRoot (client).
const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-newsreader',
});

export const metadata: Metadata = {
  title: 'Vouch — Lock a little cash on a habit you’ll keep',
};

/** Reveal delay for a .vl-r element. */
const d = (delay: string) => ({ '--d': delay }) as CSSProperties;

export default function Landing() {
  return (
    <LandingRoot className={`is-landing ${newsreader.variable}`}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <defs>
          <symbol id="vmark" viewBox="0 0 512 512"><path fill="currentColor" fillRule="evenodd" d="M191.40 476.00C203.30 475.31 214.63 470.41 223.28 462.20C232.51 453.43 237.00 442.96 238.95 430.55C240.82 418.66 240.00 406.50 242.23 394.70C243.32 388.93 244.69 382.81 246.22 377.14C247.81 371.24 250.54 365.93 255.18 361.85C264.11 353.99 277.12 353.12 287.97 349.17C299.27 345.05 309.79 338.94 318.96 331.17C337.30 315.62 349.59 293.98 353.56 270.27C357.59 246.18 352.87 222.47 340.67 201.41C334.45 190.66 329.33 180.12 332.52 167.39C333.98 161.60 337.05 156.23 339.71 150.92C342.38 145.60 344.92 140.01 347.96 134.91C354.03 124.72 362.25 116.16 367.98 105.66C373.93 94.76 375.96 83.02 372.99 70.87C367.05 46.56 342.99 31.18 318.43 36.00C306.71 38.30 296.27 45.02 289.32 54.74C282.05 64.92 280.16 76.63 279.20 88.81C278.73 94.79 278.49 100.80 277.56 106.74C276.63 112.63 274.91 118.49 273.43 124.27C270.00 137.63 266.51 146.42 252.02 150.37C246.37 151.91 240.54 152.19 234.80 153.24C228.89 154.32 223.09 155.92 217.46 158.02C206.20 162.22 195.72 168.42 186.61 176.26C168.25 192.07 156.08 214.02 152.40 237.97C148.74 261.73 153.65 286.13 166.20 306.64C172.52 316.96 180.14 325.91 178.90 338.92C178.30 345.20 175.74 350.25 172.93 355.77C170.22 361.10 167.65 366.59 164.43 371.64C158.02 381.66 150.06 390.29 144.39 400.88C138.58 411.74 136.52 423.60 139.01 435.73C144.05 460.27 166.38 477.44 191.40 476.00ZM257.33 313.33C241.55 314.45 225.90 309.26 213.91 298.93C201.78 288.47 194.30 273.54 193.21 257.57C192.13 241.78 197.35 226.14 207.71 214.18C218.19 202.07 233.14 194.63 249.12 193.57C264.90 192.52 280.53 197.79 292.47 208.17C304.41 218.55 311.79 233.30 312.95 249.08C314.11 265.05 308.82 280.89 298.29 292.95C287.88 304.86 273.11 312.21 257.33 313.33Z"/></symbol>
          {/* Wax seal: an uneven blob of wax, a pressed ring, the mark in the middle. Colour comes from currentColor. */}
          <symbol id="vseal" viewBox="0 0 120 120">
            <path fill="currentColor" d="M113.9 60.0 L115.1 61.9 L115.5 63.9 L115.2 65.8 L114.4 67.6 L113.4 69.4 L112.7 71.2 L112.1 73.0 L111.6 74.8 L110.6 76.4 L109.1 77.9 L107.3 79.1 L105.6 80.3 L104.4 81.6 L103.8 83.3 L103.8 85.3 L103.9 87.4 L103.6 89.4 L102.7 91.0 L101.3 92.3 L99.7 93.4 L98.2 94.4 L97.0 95.7 L95.8 97.0 L94.5 98.3 L92.8 99.1 L90.9 99.5 L88.8 99.6 L86.9 99.9 L85.4 100.7 L84.4 102.2 L83.5 104.2 L82.6 106.3 L81.4 108.0 L79.9 109.1 L78.1 109.8 L76.4 110.4 L74.7 111.1 L73.0 112.1 L71.3 113.0 L69.4 113.5 L67.5 113.4 L65.5 112.6 L63.6 111.6 L61.8 110.9 L60.0 110.8 L58.2 111.5 L56.3 112.5 L54.4 113.4 L52.4 113.7 L50.6 113.5 L48.8 112.9 L47.0 112.3 L45.1 112.0 L43.2 111.7 L41.3 111.3 L39.7 110.3 L38.4 108.6 L37.3 106.5 L36.5 104.3 L35.4 102.5 L34.1 101.4 L32.4 100.9 L30.5 100.6 L28.7 100.1 L27.2 99.1 L25.9 97.9 L24.7 96.6 L23.3 95.5 L21.7 94.5 L19.9 93.6 L18.5 92.5 L17.5 90.9 L17.2 88.9 L17.3 86.7 L17.4 84.6 L17.0 82.9 L16.0 81.5 L14.5 80.3 L12.9 79.0 L11.5 77.6 L10.6 76.1 L9.9 74.4 L9.1 72.7 L8.0 71.1 L6.7 69.4 L5.4 67.7 L4.6 65.8 L4.7 63.9 L5.6 61.9 L6.9 60.0 L8.0 58.2 L8.7 56.4 L8.7 54.6 L8.4 52.7 L8.2 50.9 L8.4 49.0 L8.9 47.3 L9.6 45.5 L10.1 43.8 L10.1 41.9 L10.0 39.8 L10.1 37.8 L10.8 36.0 L12.3 34.6 L14.4 33.7 L16.7 32.9 L18.7 32.1 L20.2 31.1 L21.2 29.7 L22.0 28.1 L23.0 26.7 L24.3 25.5 L25.7 24.4 L27.0 23.3 L28.0 21.8 L28.7 19.9 L29.4 17.9 L30.3 16.0 L31.7 14.6 L33.5 14.1 L35.6 14.1 L37.7 14.2 L39.5 14.0 L41.2 13.4 L42.7 12.4 L44.2 11.4 L45.8 10.6 L47.6 10.2 L49.4 9.9 L51.1 9.4 L52.7 8.3 L54.4 6.7 L56.2 5.2 L58.0 4.1 L60.0 3.8 L61.9 4.5 L63.8 5.7 L65.6 6.9 L67.3 7.8 L69.1 8.3 L70.9 8.6 L72.7 9.1 L74.3 10.0 L75.9 11.2 L77.4 12.3 L79.0 13.0 L80.9 13.1 L83.0 12.9 L85.1 12.8 L87.1 13.1 L88.6 14.3 L89.7 16.0 L90.5 18.0 L91.3 19.9 L92.4 21.4 L93.6 22.7 L94.9 23.9 L95.9 25.3 L96.6 27.0 L97.2 28.8 L98.0 30.3 L99.3 31.5 L101.1 32.3 L103.3 32.9 L105.5 33.7 L107.2 34.9 L108.1 36.5 L108.5 38.4 L108.6 40.3 L109.0 42.2 L109.6 43.9 L110.4 45.6 L111.0 47.3 L111.1 49.1 L110.8 51.0 L110.4 52.9 L110.4 54.7 L111.1 56.4 L112.3 58.2Z"/>
            <ellipse cx="44" cy="38" rx="26" ry="14" fill="#fff" opacity=".16" transform="rotate(-28 44 38)"/>
            <circle cx="60" cy="60" r="39" fill="none" stroke="#000" strokeOpacity=".22" strokeWidth="3"/>
            <circle cx="60" cy="60" r="39" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="1" transform="translate(-.8 -.8)"/>
            <circle cx="60" cy="60" r="45" fill="none" stroke="#fff" strokeOpacity=".3" strokeWidth="1.4" strokeDasharray="1.5 4.2"/>
            <use href="#vmark" x="36" y="36" width="48" height="48" style={{ color: '#FFFBF5' } as CSSProperties}/>
          </symbol>
        </defs>
      </svg>

      {/* The BCH Blaze banner is left out: the app shows it only once Douglas sends real
           Presentation / GitHub / EMBER2026 values, and hides it entirely while none are set. */}

      <header className="nav">
        <div className="nav-inner">
          <Link className="brand" href="/" aria-label="Vouch home">
            <svg className="brand-mark" width="32" height="32" aria-hidden="true"><use href="#vmark"/></svg>
            <span className="wordmark">Vouch<span>.</span></span>
          </Link>
          <div className="nav-actions">
            <NetworkBadge />
            <ConnectWallet variant="ghost" />
            <Link className="btn btn-primary" href="/create">Open app</Link>
          </div>
        </div>
      </header>

      <main id="story">
        {/* 1 · Hero */}
        <section className="vl-hero vl-doc" aria-labelledby="h-hero">
          <div className="wrap vl-hero-grid">
            <div className="vl-hero-copy">
              <p className="vl-eyebrow vl-r">Bitcoin Cash · <NetworkName /></p>
              <h1 id="h-hero" className="vl-r" style={d('.08s')}>Lock a little cash on a habit <em className="vl-serif">you’ll keep.</em></h1>
              <p className="vl-lede vl-r" style={d('.16s')}>Keep your word and the coins come back to you. Break it, or let the deadline pass, and they go to someone you chose.</p>
              <div className="vl-cta vl-r" style={d('.24s')}>
                <Link className="btn btn-primary btn-lg" href="/create">Open app</Link>
                <a className="btn btn-ghost btn-lg" href="#promise">How it works</a>
              </div>
              <p className="vl-foot-note vl-r" style={d('.32s')}>CashScript covenant on <NetworkName /> · connect with WizardConnect, e.g. Paytaca</p>
            </div>

            <div className="vl-hero-ticket vl-r" style={d('.2s')}>
              <div className="vl-ticket-float">
                <div className="vl-ticket-tilt">
              <article className="ticket" aria-label="Example pledge ticket">
                <div className="ticket-stub">
                  <svg className="brand-mark" width="24" height="24" aria-hidden="true"><use href="#vmark"/></svg>
                  <span className="stub-label">Vouch</span>
                </div>
                <div className="ticket-body">
                  <div className="ticket-top">
                    <div>
                      <p className="ticket-kicker">Pledge ticket</p>
                      <p className="example-tag">Example only — not a live pledge</p>
                    </div>
                    <div className="stamp" aria-hidden="true">Active</div>
                  </div>
                  <h2 className="ticket-habit">Run three mornings this week.</h2>
                  <div className="ticket-grid">
                    <div><p className="field-label">Stake</p><p className="field-value">0.05 BCH</p></div>
                    <div><p className="field-label">Deadline</p><p className="field-value">27 Nov 2026, 23:59 WAT</p></div>
                    <div><p className="field-label">Verifier</p><p className="field-value">Vouch demo</p></div>
                    <div><p className="field-label">Beneficiary</p><p className="field-value">Chidi</p><p className="addr">bitcoincash:p…</p></div>
                  </div>
                  <div className="ticket-outcomes">
                    <p className="outcome"><b>If you keep it</b> Coins return to you once you and the verifier sign.</p>
                    <p className="outcome is-forfeit"><b>If you don’t</b> The 0.05 BCH is paid to Chidi. Same if time runs out.</p>
                  </div>
                </div>
              </article>
              <svg className="vl-seal vl-seal-ticket" viewBox="0 0 120 120" aria-hidden="true"><use href="#vseal"/></svg>
                </div>
              </div>
            </div>
          </div>
          <a className="vl-scroll-cue" href="#promise"><span>Read the story</span><i aria-hidden="true"></i></a>
        </section>

        {/* 2 · The promise */}
        <section className="vl-doc vl-sec" id="promise" aria-labelledby="h-promise">
          <div className="wrap">
            <div className="vl-rule vl-r"><span>§ 01 · The promise</span><i></i><svg className="vl-seal vl-seal-sm" viewBox="0 0 120 120" aria-hidden="true"><use href="#vseal"/></svg></div>
            <div className="vl-two">
              <div>
                <h2 id="h-promise" className="vl-h2 vl-r" style={d('.06s')}>Say what you’ll do. <em className="vl-serif">Put money on it.</em></h2>
                <p className="vl-body vl-r" style={d('.12s')}>Name the habit, choose how much BCH to lock, and pick a deadline. Then name the person who gets the coins if you slip. That’s the whole promise.</p>
                <p className="vl-foot-note vl-r" style={d('.18s')}>minimum stake 546 sats + network fee · verifier ≠ beneficiary</p>
              </div>
              <article className="vl-deed vl-r" style={d('.12s')} aria-label="Example promise">
                <p className="vl-deed-kicker">Example only</p>
                <dl>
                  <div><dt>I will</dt><dd className="vl-hand">run three mornings this week.</dd></div>
                  <div><dt>I lock</dt><dd className="vl-hand">0.05 BCH</dd></div>
                  <div><dt>Until</dt><dd className="vl-hand">27 Nov 2026, 23:59 WAT</dd></div>
                  <div><dt>If I slip, pay</dt><dd className="vl-hand">Chidi</dd></div>
                </dl>
              </article>
            </div>
          </div>
        </section>

        {/* 3 · Someone vouches */}
        <section className="vl-doc vl-sec vl-sec-alt" id="vouches" aria-labelledby="h-vouch">
          <div className="wrap">
            <div className="vl-rule vl-r"><span>§ 02 · Someone vouches</span><i></i><svg className="vl-seal vl-seal-sm" viewBox="0 0 120 120" aria-hidden="true"><use href="#vseal"/></svg></div>
            <div className="vl-two">
              <div>
                <h2 id="h-vouch" className="vl-h2 vl-r" style={d('.06s')}>Someone puts <em className="vl-serif">their name</em> next to yours.</h2>
                <p className="vl-body vl-r" style={d('.12s')}>Getting your coins back takes two signatures: yours and your verifier’s. Use the Vouch demo verifier, or send a friend a link.</p>
                <div className="vl-sign vl-r" style={d('.18s')} aria-label="Signatures on the refund">
                  <div className="vl-sign-line">
                    <svg className="vl-scribble" viewBox="0 0 220 48" aria-hidden="true"><path d="M6 34c12-20 20-26 24-18s-6 22 2 20 14-30 22-26-4 24 4 22 12-16 18-14 2 12 10 10 10-10 16-8c8 3 14 6 30 2 14-4 30-10 50-12" /></svg>
                    <span className="vl-cover" aria-hidden="true"></span>
                    <p><b>You</b> sign the refund in your wallet</p>
                  </div>
                  <div className="vl-sign-line is-second">
                    <svg className="vl-scribble" viewBox="0 0 220 48" aria-hidden="true"><path d="M8 30c8-8 16-22 26-20s-4 26 6 24 16-28 26-22-2 18 6 18 14-12 22-10 6 10 14 8c10-3 22-14 34-12s18 10 30 8c10-2 22-8 40-10" /></svg>
                    <span className="vl-cover" aria-hidden="true"></span>
                    <p><b>Your verifier</b> co-signs it</p>
                  </div>
                </div>
              </div>
              <div className="vl-cards">
                <article className="vl-card vl-r" style={d('.12s')}>
                  <p className="vl-card-kicker">Option one</p>
                  <h3>The Vouch demo verifier</h3>
                  <p>It co-signs when you say you kept your word. It works on the honour system, and it can’t break your pledge.</p>
                  <p className="vl-code">server-side key · co-signs refunds only</p>
                </article>
                <article className="vl-card vl-r" style={d('.2s')}>
                  <p className="vl-card-kicker">Option two</p>
                  <h3>A friend with a link</h3>
                  <p>They open the link, check in on you, and sign the refund in their own wallet.</p>
                  <p className="vl-code">/verify#pledge=…</p>
                </article>
                <p className="vl-foot-note vl-r" style={d('.26s')}>WizardConnect can’t sign raw messages, so the verifier signs the refund transaction itself.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 4 · Sealed in a contract (dark) */}
        <section className="vl-doc vl-sec vl-dark" id="sealed" aria-labelledby="h-sealed">
          <div className="wrap">
            <div className="vl-rule vl-r"><span>§ 03 · Sealed in a contract</span><i></i><svg className="vl-seal vl-seal-sm" viewBox="0 0 120 120" aria-hidden="true"><use href="#vseal"/></svg></div>
            <div className="vl-sealed">
              <div className="vl-sealed-copy">
                <h2 id="h-sealed" className="vl-h2 vl-r" style={d('.06s')}>Sealed. <em className="vl-serif">Neither of you</em> can take it alone.</h2>
                <p className="vl-body vl-r" style={d('.12s')}>The coins sit in a CashScript covenant on <NetworkName />. Not in our wallet, and not in your friend’s. The contract only lets them leave three ways.</p>
                <p className="vl-foot-note vl-r" style={d('.18s')}>covenant: fee cap · outputs bound to each pledge · checkSig(verifier)</p>
              </div>
              <div className="vl-vault vl-r" style={d('.1s')}>
                <div className="vl-vault-seal">
                  <svg className="vl-seal vl-seal-lg" viewBox="0 0 120 120" aria-hidden="true"><use href="#vseal"/></svg>
                  <p className="vl-vault-amt">0.05 BCH<span>locked · example</span></p>
                </div>
                <ol className="vl-exits">
                  <li className="vl-r" style={d('.22s')}><b>Refund → you</b><span>Needs your signature and your verifier’s.</span></li>
                  <li className="vl-r is-forfeit" style={d('.3s')}><b>Break → Chidi</b><span>Only you can sign it, from your own wallet.</span></li>
                  <li className="vl-r is-forfeit" style={d('.38s')}><b>Forfeit → Chidi</b><span>Anyone can send it once the deadline passes.</span></li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* 5 · Two endings */}
        <section className="vl-doc vl-sec" id="endings" aria-labelledby="h-end">
          <div className="wrap">
            <div className="vl-rule vl-r"><span>§ 04 · Two endings</span><i></i><svg className="vl-seal vl-seal-sm" viewBox="0 0 120 120" aria-hidden="true"><use href="#vseal"/></svg></div>
            <h2 id="h-end" className="vl-h2 vl-h2-center vl-r" style={d('.06s')}>Two ways <em className="vl-serif">this ends.</em></h2>
            <div className="vl-endings">
              <article className="vl-end is-kept vl-r" style={d('.12s')}>
                <div className="vl-end-stamp" aria-hidden="true">Kept</div>
                <p className="vl-card-kicker">You kept it</p>
                <h3>The coins come back.</h3>
                <p>You and your verifier sign, and the contract returns the stake to your wallet.</p>
              </article>
              <article className="vl-end is-paid vl-r" style={d('.22s')}>
                <div className="vl-end-stamp" aria-hidden="true">Paid</div>
                <p className="vl-card-kicker">You broke it, or time ran out</p>
                <h3>Chidi gets paid.</h3>
                <p>Break it yourself, or miss the deadline, and the stake goes to the person you named. Vouch settles expiry on its own, with a Settle button as backup.</p>
              </article>
            </div>
            <p className="vl-foot-note vl-center vl-r" style={d('.3s')}>After the deadline a refund and a forfeit can race, so get it verified at least an hour before.</p>
          </div>
        </section>
      </main>

      {/* 6 · Meadow close + footer */}
      <section className="vl-meadow" id="open" aria-labelledby="h-close">
        <canvas className="vl-meadow-canvas" aria-hidden="true"></canvas>
        <div className="vl-close">
          <h2 id="h-close" className="vl-close-h">
            <span className="vl-line"><span className="vl-w"><span>Make</span></span> <span className="vl-w"><span>a</span></span> <span className="vl-w"><span>promise</span></span></span>
            <span className="vl-line vl-line-accent"><em className="vl-accent">worth keeping</em></span>
            <span className="vl-line"><span className="vl-w"><span>with</span></span> <span className="vl-w"><span>Vouch.</span></span></span>
          </h2>
          <p className="vl-close-sub">It takes about a minute. You’ll need a <NetworkName /> wallet, such as Paytaca.</p>
          <Link className="vl-pill" href="/create">
            <span>Open app</span>
            <i aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></i>
          </Link>
        </div>
        <div className="vl-hillspace" aria-hidden="true"></div>
        <footer className="vl-foot">
          <div className="vl-foot-inner">
            <div className="vl-foot-brand">
              <Link className="vl-foot-logo" href="/" aria-label="Vouch home">
                <svg className="vl-foot-mark" width="36" height="36" aria-hidden="true"><use href="#vmark"/></svg>
                <span className="wordmark">Vouch<span>.</span></span>
              </Link>
              <p>Stake BCH on a habit. Someone vouches. The contract keeps everyone honest.</p>
            </div>
            <nav className="vl-foot-links" aria-label="Footer">
              <a href="#promise">How it works</a>
              <Link href="/pledges">Pledges</Link>
              <Link href="/verify">Verify</Link>
              {/* Hidden until the public repo URL is set (NEXT_PUBLIC_REPO_URL). */}
              {REPO_URL ? <a className="vl-gh" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a> : null}
            </nav>
          </div>
          <p className="vl-foot-base">Built for BCH Blaze 2026 · <NetworkName /></p>
        </footer>
      </section>
    </LandingRoot>
  );
}
