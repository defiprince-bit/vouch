import { Suspense } from 'react';
import { PledgesRoute } from './PledgesRoute';

export default function PledgesPage() {
  return (
    <main className="wrap page">
      <Suspense fallback={<p className="hint">Loading…</p>}>
        <PledgesRoute />
      </Suspense>
    </main>
  );
}
