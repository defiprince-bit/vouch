// Wall registry storage. Production: Turso (libSQL over its HTTP pipeline API, so no extra
// dependency). Tests: MemoryWallStore. Server-only: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are
// never NEXT_PUBLIC_ and never sent to the browser.
//
// Schema (vouch-wall database):
//   listings(pledge_id TEXT PRIMARY KEY, contract_address TEXT UNIQUE, network, version, habit
//            (1..140 chars), staker_pubkey, terms_json, created_at, legacy, hidden, state,
//            state_json, checked_at)
//   list_attempts(id, ip_hash, staker_pubkey, at)        -- rate limiting for POST /api/wall
// To pull a listing without a redeploy:  UPDATE listings SET hidden = 1 WHERE pledge_id = '<hex>';
import type { BchNetwork } from '@/lib/providers';
import type { WallState } from '@/lib/wall';

export interface ListingRow {
  pledgeId: string;
  contractAddress: string;
  network: BchNetwork;
  version: 1 | 2;
  habit: string;
  stakerPubkey: string;
  /** JSON of the server-side PledgeTerms (enough to rebuild the contract). */
  termsJson: string;
  createdAt: number;
  legacy: boolean;
  hidden: boolean;
  /** Last derived on-chain state, and when it was read. */
  state: WallState | null;
  stateJson: string | null;
  checkedAt: number | null;
}

export class DuplicateListingError extends Error {}

export interface WallStore {
  readonly kind: 'turso' | 'memory' | 'legacy-only';
  /** Visible (not hidden) listings on a network, newest first. */
  list(network: BchNetwork): Promise<ListingRow[]>;
  insert(row: ListingRow): Promise<void>;
  saveState(pledgeId: string, state: WallState, stateJson: string, checkedAt: number): Promise<void>;
  /** Listings by this staker that aren't known to have ended (state active or not read yet). */
  countActiveForStaker(stakerPubkey: string): Promise<number>;
  recordAttempt(ipHash: string, stakerPubkey: string | null, at: number): Promise<void>;
  countAttempts(since: number, by: { ipHash?: string; stakerPubkey?: string }): Promise<number>;
}

// ---------------------------------------------------------------------------------------------

type Arg = string | number | null;
type Cell = { type: string; value?: string };

export class TursoWallStore implements WallStore {
  readonly kind = 'turso' as const;
  readonly #url: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  constructor(url: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.#token = token;
    this.#fetch = fetchImpl;
    this.#url = url.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '');
  }

  async #exec(sql: string, args: Arg[] = []): Promise<{ cols: string[]; rows: Cell[][]; affected: number }> {
    const enc = (a: Arg) =>
      a === null ? { type: 'null' } : typeof a === 'number' ? (Number.isInteger(a) ? { type: 'integer', value: String(a) } : { type: 'float', value: a }) : { type: 'text', value: a };
    const res = await this.#fetch(`${this.#url}/v2/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: args.map(enc) } }, { type: 'close' }] }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`wall registry: HTTP ${res.status}`);
    const json = (await res.json()) as {
      results: Array<{ type: 'ok' | 'error'; error?: { message: string }; response?: { result: { cols: { name: string }[]; rows: Cell[][]; affected_row_count: number } } }>;
    };
    const r = json.results[0];
    if (r.type === 'error') {
      const msg = r.error?.message ?? 'error';
      if (/UNIQUE constraint failed/i.test(msg)) throw new DuplicateListingError(msg);
      throw new Error(`wall registry: ${msg.slice(0, 200)}`);
    }
    const result = r.response!.result;
    return { cols: result.cols.map((c) => c.name), rows: result.rows, affected: result.affected_row_count };
  }

  static #row(cols: string[], cells: Cell[]): ListingRow {
    const v = (name: string) => cells[cols.indexOf(name)];
    const s = (name: string) => (v(name)?.type === 'null' ? null : (v(name)?.value ?? null));
    const n = (name: string) => (s(name) === null ? null : Number(s(name)));
    return {
      pledgeId: s('pledge_id')!,
      contractAddress: s('contract_address')!,
      network: s('network') as BchNetwork,
      version: n('version') as 1 | 2,
      habit: s('habit')!,
      stakerPubkey: s('staker_pubkey')!,
      termsJson: s('terms_json')!,
      createdAt: n('created_at')!,
      legacy: n('legacy') === 1,
      hidden: n('hidden') === 1,
      state: s('state') as WallState | null,
      stateJson: s('state_json'),
      checkedAt: n('checked_at'),
    };
  }

  async list(network: BchNetwork) {
    const r = await this.#exec('SELECT * FROM listings WHERE network = ? AND hidden = 0 ORDER BY created_at DESC LIMIT 200', [network]);
    return r.rows.map((cells) => TursoWallStore.#row(r.cols, cells));
  }
  async insert(x: ListingRow) {
    await this.#exec(
      'INSERT INTO listings (pledge_id, contract_address, network, version, habit, staker_pubkey, terms_json, created_at, legacy, hidden, state, state_json, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [x.pledgeId, x.contractAddress, x.network, x.version, x.habit, x.stakerPubkey, x.termsJson, x.createdAt, x.legacy ? 1 : 0, x.hidden ? 1 : 0, x.state, x.stateJson, x.checkedAt],
    );
  }
  async saveState(pledgeId: string, state: WallState, stateJson: string, checkedAt: number) {
    await this.#exec('UPDATE listings SET state = ?, state_json = ?, checked_at = ? WHERE pledge_id = ?', [state, stateJson, checkedAt, pledgeId]);
  }
  async countActiveForStaker(stakerPubkey: string) {
    const r = await this.#exec("SELECT COUNT(*) AS n FROM listings WHERE staker_pubkey = ? AND hidden = 0 AND (state IS NULL OR state = 'active')", [stakerPubkey]);
    return Number(r.rows[0]?.[0]?.value ?? 0);
  }
  async recordAttempt(ipHash: string, stakerPubkey: string | null, at: number) {
    await this.#exec('INSERT INTO list_attempts (ip_hash, staker_pubkey, at) VALUES (?,?,?)', [ipHash, stakerPubkey, at]);
    // keep the table small: drop attempts older than a day now and then
    if (Math.random() < 0.05) await this.#exec('DELETE FROM list_attempts WHERE at < ?', [at - 86_400_000]);
  }
  async countAttempts(since: number, by: { ipHash?: string; stakerPubkey?: string }) {
    const [col, val] = by.ipHash ? ['ip_hash', by.ipHash] : ['staker_pubkey', by.stakerPubkey!];
    const r = await this.#exec(`SELECT COUNT(*) FROM list_attempts WHERE at >= ? AND ${col} = ?`, [since, val]);
    return Number(r.rows[0]?.[0]?.value ?? 0);
  }
}

// ---------------------------------------------------------------------------------------------

export class MemoryWallStore implements WallStore {
  kind: 'memory' | 'legacy-only' = 'memory';
  rows: ListingRow[] = [];
  attempts: Array<{ ipHash: string; stakerPubkey: string | null; at: number }> = [];
  constructor(seed: ListingRow[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  async list(network: BchNetwork) {
    return this.rows.filter((r) => r.network === network && !r.hidden).sort((a, b) => b.createdAt - a.createdAt);
  }
  async insert(row: ListingRow) {
    if (this.rows.some((r) => r.pledgeId === row.pledgeId || r.contractAddress === row.contractAddress)) throw new DuplicateListingError('UNIQUE constraint failed');
    this.rows.push({ ...row });
  }
  async saveState(pledgeId: string, state: WallState, stateJson: string, checkedAt: number) {
    const r = this.rows.find((x) => x.pledgeId === pledgeId);
    if (r) Object.assign(r, { state, stateJson, checkedAt });
  }
  async countActiveForStaker(stakerPubkey: string) {
    return this.rows.filter((r) => r.stakerPubkey === stakerPubkey && !r.hidden && (r.state === null || r.state === 'active')).length;
  }
  async recordAttempt(ipHash: string, stakerPubkey: string | null, at: number) {
    this.attempts.push({ ipHash, stakerPubkey, at });
  }
  async countAttempts(since: number, by: { ipHash?: string; stakerPubkey?: string }) {
    return this.attempts.filter((a) => a.at >= since && (by.ipHash ? a.ipHash === by.ipHash : a.stakerPubkey === by.stakerPubkey)).length;
  }
}
