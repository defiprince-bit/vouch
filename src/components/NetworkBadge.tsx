import { IS_MAINNET } from '@/lib/config';

export function NetworkBadge() {
  return IS_MAINNET ? (
    <span className="rounded-full border border-amber-400/60 bg-amber-400/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-amber-300">Mainnet · real BCH</span>
  ) : (
    <span className="rounded-full border border-sky-400/50 bg-sky-400/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-sky-300">Chipnet · test coins</span>
  );
}
