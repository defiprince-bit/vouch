import { NextResponse } from 'next/server';
import { VerifierError } from './verifier';

export function jsonError(e: unknown) {
  if (e instanceof VerifierError) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg.slice(0, 400) }, { status: 502 });
}

export function networkParam(v: unknown): 'chipnet' | 'mainnet' {
  if (v === 'mainnet' || v === 'chipnet') return v;
  throw new VerifierError('network must be chipnet or mainnet');
}
