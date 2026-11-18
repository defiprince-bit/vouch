import { NextResponse } from 'next/server';
import { VerifierError } from './verifier';
import { addressNetwork } from '@/lib/network';

export function jsonError(e: unknown) {
  if (e instanceof VerifierError) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg.slice(0, 400) }, { status: 502 });
}

export function networkParam(v: unknown): 'chipnet' | 'mainnet' {
  if (v === 'mainnet' || v === 'chipnet') return v;
  throw new VerifierError('network must be chipnet or mainnet');
}

/** An address query param must be a valid CashAddress on `network` (bchtest: on chipnet, bitcoincash: on mainnet). */
export function addressParam(v: unknown, network: 'chipnet' | 'mainnet'): string {
  const a = typeof v === 'string' ? v.trim().toLowerCase() : '';
  const n = addressNetwork(a);
  if (!n) throw new VerifierError('address must be a valid CashAddress with its prefix');
  if (n !== network) throw new VerifierError(`address is a ${n} address but network is ${network}`);
  return a;
}
