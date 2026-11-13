// Box-only fallback NetworkProvider for chipnet over HTTPS (the box's egress blocks Electrum ports).
// UTXOs / broadcast via mainnet.cash REST using WATCH-ONLY wallet ids (no private keys leave the box);
// block height scraped from the chipnet.imaginary.cash explorer. The app itself uses ElectrumNetworkProvider.
import type { NetworkProvider, SpendableUtxo } from 'cashscript';
import { cashAddressToLockingBytecode, binToHex } from '@bitauth/libauth';

const API = 'https://rest-unstable.mainnet.cash';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

export class RestChipnetProvider implements NetworkProvider {
  network = 'chipnet' as const;
  constructor(private watchAddress: string) {}

  async getUtxos(address: string): Promise<SpendableUtxo[]> {
    const rows = await post<Array<{ txid: string; vout: number; satoshis: string | number; token?: unknown }>>('/wallet/utxo', {
      walletId: `watch:testnet:${address}`,
    });
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string') throw new Error(decoded);
    const lockingBytecode = binToHex(decoded.bytecode);
    return rows
      .filter((r) => !r.token)
      .map((r) => ({ txid: r.txid, vout: r.vout, satoshis: BigInt(r.satoshis), lockingBytecode }));
  }

  async getUtxosForLockingBytecode(): Promise<SpendableUtxo[]> {
    throw new Error('not supported by RestChipnetProvider');
  }

  async getBlockHeight(): Promise<number> {
    const html = await (await fetch('https://chipnet.imaginary.cash/')).text();
    // first row of the "Latest Blocks" table: "... % Full 1 332,179 ..."
    const m = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').match(/Full 1 (\d{1,3},\d{3})/);
    if (!m) throw new Error('could not read chipnet height');
    return Number(m[1].replace(',', ''));
  }

  async getRawTransaction(txid: string): Promise<string> {
    const r = await post<{ txHex: string }>('/wallet/util/get_raw_transaction', { txHash: txid, network: 'testnet' });
    return r.txHex;
  }

  async sendRawTransaction(txHex: string): Promise<string> {
    const r = await post<{ txId: string }>('/wallet/submit_transaction', {
      walletId: `watch:testnet:${this.watchAddress}`,
      transactionHex: txHex,
      awaitPropagation: true,
    });
    return r.txId;
  }
}
