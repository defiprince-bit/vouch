// Network providers. Preference: Electrum (wss) first, HTTPS REST fallback second.
//   NEXT_PUBLIC_BCH_PROVIDER = auto (default) | electrum | rest
// In the browser, REST goes through our own /api/chain proxy (avoids CORS); on the server it calls
// the upstream HTTPS APIs directly. REST upstreams: mainnet.cash (UTXOs, raw tx, broadcast, using
// watch-only wallet ids, so no private keys ever leave the app) + a block-height source per network.
import { ElectrumNetworkProvider, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { cashAddressToLockingBytecode, binToHex, encodeCashAddress, CashAddressType } from '@bitauth/libauth';

export type BchNetwork = 'chipnet' | 'mainnet';
export type ProviderMode = 'auto' | 'electrum' | 'rest';

const MAINNET_CASH = 'https://rest-unstable.mainnet.cash';
const mcNet = (n: BchNetwork) => (n === 'mainnet' ? 'mainnet' : 'testnet'); // mainnet.cash "testnet" = chipnet

export function providerMode(): ProviderMode {
  const m = process.env.NEXT_PUBLIC_BCH_PROVIDER;
  return m === 'electrum' || m === 'rest' ? m : 'auto';
}

async function mcPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(MAINNET_CASH + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mainnet.cash ${path} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function lockingBytecodeHex(address: string): string {
  const d = cashAddressToLockingBytecode(address);
  if (typeof d === 'string') throw new Error(d);
  return binToHex(d.bytecode);
}

const heightCache: Partial<Record<BchNetwork, { height: number; at: number }>> = {};

const CHIPNET_HEIGHT_SOURCES: Array<() => Promise<number>> = [
  // public JSON from the chipnet.bch.ninja faucet
  async () => ((await (await fetch('https://chipnet.bch.ninja/api/pool')).json()) as { height: number }).height,
  // explorer "latest blocks" table (rate-limited, so second)
  async () => {
    const html = await (await fetch('https://chipnet.imaginary.cash/')).text();
    const m = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').match(/Full 1 (\d{1,3}(?:,\d{3})+)/);
    if (!m) throw new Error('explorer height not found');
    return Number(m[1].replace(/,/g, ''));
  },
];

const MAINNET_HEIGHT_SOURCES: Array<() => Promise<number>> = [
  async () => ((await (await fetch('https://api.blockchair.com/bitcoin-cash/stats')).json()) as { data: { best_block_height: number } }).data.best_block_height,
];

/** Direct upstream calls (server side, or scripts). */
export const restUpstream = {
  async utxos(network: BchNetwork, address: string): Promise<SpendableUtxo[]> {
    const rows = await mcPost<Array<{ txid: string; vout: number; satoshis: string | number; token?: unknown }>>(
      '/wallet/utxo',
      { walletId: `watch:${mcNet(network)}:${address}` },
    );
    const lockingBytecode = lockingBytecodeHex(address);
    return rows.filter((r) => !r.token).map((r) => ({ txid: r.txid, vout: r.vout, satoshis: BigInt(r.satoshis), lockingBytecode }));
  },
  async height(network: BchNetwork): Promise<number> {
    const cached = heightCache[network];
    if (cached && Date.now() - cached.at < 30_000) return cached.height;
    const sources = network === 'mainnet' ? MAINNET_HEIGHT_SOURCES : CHIPNET_HEIGHT_SOURCES;
    const errors: string[] = [];
    for (const src of sources) {
      try {
        const height = await src();
        if (Number.isInteger(height) && height > 0) {
          heightCache[network] = { height, at: Date.now() };
          return height;
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    throw new Error(`could not read ${network} height (${errors.join('; ')})`);
  },
  async rawTx(network: BchNetwork, txid: string): Promise<string> {
    const r = await mcPost<{ txHex: string }>('/wallet/util/get_raw_transaction', { txHash: txid, network: mcNet(network) });
    return r.txHex;
  },
  async broadcast(network: BchNetwork, txHex: string, anyAddress: string): Promise<string> {
    const r = await mcPost<{ txId: string }>('/wallet/submit_transaction', {
      walletId: `watch:${mcNet(network)}:${anyAddress}`,
      transactionHex: txHex,
      awaitPropagation: true,
    });
    return r.txId;
  },
};

/** Any valid address for the network: mainnet.cash's submit endpoint needs a (watch-only) wallet id. */
const watchAddress = (n: BchNetwork) =>
  encodeCashAddress({ prefix: n === 'mainnet' ? 'bitcoincash' : 'bchtest', type: CashAddressType.p2pkh, payload: new Uint8Array(20) }).address;

/** REST provider. `proxyBase` set => call our /api/chain proxy (browser); unset => call upstream directly. */
export class RestNetworkProvider implements NetworkProvider {
  constructor(
    public network: BchNetwork,
    private proxyBase?: string,
  ) {}

  private async proxy<T>(op: string, params: Record<string, string>, body?: unknown): Promise<T> {
    const qs = new URLSearchParams({ network: this.network, ...params }).toString();
    const res = await fetch(`${this.proxyBase}/api/chain/${op}?${qs}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `chain proxy ${op} ${res.status}`);
    return json;
  }

  async getUtxos(address: string): Promise<SpendableUtxo[]> {
    if (!this.proxyBase) return restUpstream.utxos(this.network, address);
    const r = await this.proxy<{ utxos: Array<{ txid: string; vout: number; satoshis: string; lockingBytecode: string }> }>('utxos', { address });
    return r.utxos.map((u) => ({ ...u, satoshis: BigInt(u.satoshis) }));
  }
  async getUtxosForLockingBytecode(): Promise<SpendableUtxo[]> {
    throw new Error('getUtxosForLockingBytecode not supported over REST');
  }
  async getBlockHeight(): Promise<number> {
    if (!this.proxyBase) return restUpstream.height(this.network);
    return (await this.proxy<{ height: number }>('height', {})).height;
  }
  async getRawTransaction(txid: string): Promise<string> {
    if (!this.proxyBase) return restUpstream.rawTx(this.network, txid);
    return (await this.proxy<{ txHex: string }>('tx', { txid })).txHex;
  }
  async sendRawTransaction(txHex: string): Promise<string> {
    if (!this.proxyBase) return restUpstream.broadcast(this.network, txHex, watchAddress(this.network));
    return (await this.proxy<{ txid: string }>('broadcast', {}, { txHex })).txid;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/**
 * Try the primary provider; on error/timeout, use the secondary. Broadcast is only retried on the
 * secondary when the primary failed to *connect* or timed out, not when the node rejected the tx.
 */
export class FallbackNetworkProvider implements NetworkProvider {
  network: BchNetwork;
  constructor(
    private primary: NetworkProvider,
    private secondary: NetworkProvider,
    private timeoutMs = 8000,
  ) {
    this.network = primary.network as BchNetwork;
  }
  /** After a primary failure, go straight to the secondary for a while instead of waiting on timeouts again. */
  private primaryDownUntil = 0;
  private async run<T>(f: (p: NetworkProvider) => Promise<T>, retry: (e: Error) => boolean = () => true): Promise<T> {
    if (Date.now() < this.primaryDownUntil) return f(this.secondary);
    try {
      return await withTimeout(f(this.primary), this.timeoutMs);
    } catch (e) {
      if (!retry(e as Error)) throw e;
      this.primaryDownUntil = Date.now() + 60_000;
      return f(this.secondary);
    }
  }
  getUtxos(a: string) { return this.run((p) => p.getUtxos(a)); }
  getUtxosForLockingBytecode(b: Uint8Array | string) { return this.run((p) => p.getUtxosForLockingBytecode(b)); }
  getBlockHeight() { return this.run((p) => p.getBlockHeight()); }
  getRawTransaction(t: string) { return this.run((p) => p.getRawTransaction(t)); }
  sendRawTransaction(h: string) {
    return this.run((p) => p.sendRawTransaction(h), (e) => /timed out|connect|socket|websocket|ECONN|network/i.test(e.message));
  }
}

const providerCache = new Map<string, NetworkProvider>();

/** One shared provider per network+mode, so the fallback's "Electrum is down" memory is reused. */
export function getProvider(network: BchNetwork, mode: ProviderMode = providerMode()): NetworkProvider {
  const k = `${network}:${mode}`;
  let p = providerCache.get(k);
  if (!p) providerCache.set(k, (p = createProvider(network, mode)));
  return p;
}

export function createProvider(network: BchNetwork, mode: ProviderMode = providerMode()): NetworkProvider {
  const browser = typeof window !== 'undefined';
  const rest = new RestNetworkProvider(network, browser ? window.location.origin : undefined);
  if (mode === 'rest') return rest;
  const electrum = new ElectrumNetworkProvider(network);
  if (mode === 'electrum') return electrum;
  return new FallbackNetworkProvider(electrum, rest);
}
