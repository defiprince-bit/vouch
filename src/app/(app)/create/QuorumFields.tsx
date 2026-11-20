'use client';
// Create form: a group of 1..5 verifiers (friends' keys, plus the demo verifier where allowed)
// and how many of them must approve (M of N).
import Link from 'next/link';
import { MAX_VERIFIERS, looksLikeAddress, quorumPowerCopy } from '@/lib/quorum';

export interface VerifierRow {
  name: string;
  key: string;
}

export function rowKeyError(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (looksLikeAddress(k)) return 'That’s an address. Vouch needs their public key (02… or 03…), which the contract checks their signature against. They get it from /verifier-key.';
  if (!/^0[23][0-9a-f]{64}$/i.test(k)) return 'A verifier key is 66 hex characters starting with 02 or 03.';
  return null;
}

export function QuorumFields(props: {
  rows: VerifierRow[];
  setRows: (r: VerifierRow[]) => void;
  includeDemo: boolean;
  setIncludeDemo: (b: boolean) => void;
  demoAvailable: boolean;
  threshold: number;
  setThreshold: (n: number) => void;
  /** The staker's own key (wallet or pasted), so a row holding it is flagged like a duplicate. */
  stakerHex?: string;
  /** The demo verifier's key when it's included, so a row repeating it is flagged too. */
  demoPubkey?: string | null;
}) {
  const { rows, setRows, includeDemo, setIncludeDemo, demoAvailable, threshold, setThreshold, stakerHex, demoPubkey } = props;
  const demoOn = includeDemo && demoAvailable;
  const keys = rows.map((r) => r.key.trim().toLowerCase()).filter(Boolean);
  const taken = [...(demoOn && demoPubkey ? [demoPubkey.toLowerCase()] : []), ...keys];
  const dupes = new Set(taken.filter((k, i) => taken.indexOf(k) !== i));
  const staker = stakerHex?.trim().toLowerCase() || null;
  // M can only count real verifiers: rows with a usable key, plus the demo verifier if included.
  // Distinct, valid, non-staker keys only: a flagged row never counts toward N.
  const realKeys = new Set(rows.map((r) => r.key.trim().toLowerCase()).filter((k) => k && !rowKeyError(k) && k !== staker));
  if (demoOn && demoPubkey) realKeys.add(demoPubkey.toLowerCase());
  const n = realKeys.size + (demoOn && !demoPubkey ? 1 : 0);
  const mTooBig = threshold > Math.max(1, n);
  const showMError = mTooBig && n > 0; // don't nag before any key is entered
  const power = quorumPowerCopy(Math.min(threshold, Math.max(1, n)), Math.max(1, n));
  const maxRows = MAX_VERIFIERS - (demoOn ? 1 : 0);
  const update = (i: number, patch: Partial<VerifierRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 12 }} data-testid="quorum-fields">
      {rows.map((r, i) => {
        const k = r.key.trim().toLowerCase();
        const err =
          rowKeyError(r.key) ??
          (k && staker === k ? 'That’s your own key. You can’t vouch for yourself: your verifiers have to be other people.' : null) ??
          (dupes.has(k) ? 'This key is already in the list: each verifier counts once.' : null);
        return (
          <div className="field-row" key={i}>
            <div className="field">
              <label htmlFor={`qv-name-${i}`}>Verifier {i + 1} name</label>
              <input id={`qv-name-${i}`} value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={['Amaka', 'Tunde', 'Ngozi', 'Femi', 'Zainab'][i]} />
            </div>
            <div className={`field${err ? ' is-invalid' : ''}`}>
              <label htmlFor={`qv-key-${i}`}>Verifier {i + 1} key</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id={`qv-key-${i}`} spellCheck={false} value={r.key} onChange={(e) => update(i, { key: e.target.value })} placeholder="02… or 03…" aria-invalid={!!err} />
                {rows.length > 1 && (
                  <button type="button" className="btn btn-ghost" aria-label={`Remove verifier ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </div>
              {err && <p className="field-error" role="alert">{err}</p>}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {rows.length < maxRows && (
          <button type="button" className="btn btn-ghost" onClick={() => setRows([...rows, { name: '', key: '' }])}>
            + Add a verifier
          </button>
        )}
        {demoAvailable && (
          <label className="choice" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} disabled={!includeDemo && rows.length >= MAX_VERIFIERS} />
            <span>
              <b>Include the Vouch demo verifier</b>
              <span className="choice-help">Counts as one of the group. It approves any refund you ask for.</span>
            </span>
          </label>
        )}
      </div>
      <div className={`field${showMError ? ' is-invalid' : ''}`} style={{ maxWidth: 420 }}>
        <label htmlFor="threshold">Approvals needed (M of N)</label>
        <select id="threshold" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} aria-invalid={showMError} data-testid="threshold">
          {Array.from({ length: Math.max(1, n) }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m} of {Math.max(1, n)}
            </option>
          ))}
          {mTooBig && (
            <option value={threshold} disabled>
              {threshold} of {n} (not enough verifiers)
            </option>
          )}
        </select>
        {showMError && (
          <p className="field-error" role="alert">
            {threshold} approvals needs at least {threshold} verifiers; you have {n}. Add a verifier or lower the number.
          </p>
        )}
        <p className="hint" data-testid="quorum-power">
          {n > 0 && !showMError ? power.summary : 'The same number of verifiers that can approve your refund can also force a break that pays the beneficiary.'} Signatures can come in any order. Each friend gets their key from <Link href="/verifier-key">/verifier-key</Link>; none of them may be
          the beneficiary.
        </p>
        {n > 0 && !showMError && power.warning && (
          <p className="callout callout-warn" role="note" data-testid="quorum-1ofn-warning" style={{ marginTop: 8 }}>
            {power.warning}
          </p>
        )}
      </div>
    </div>
  );
}
