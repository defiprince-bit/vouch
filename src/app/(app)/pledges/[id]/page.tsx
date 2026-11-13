import { Suspense } from 'react';
import { PledgeById } from '../PledgesRoute';

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PledgeById id={id} />;
}

/** /pledges/<pledgeId>: one pledge's status. Pledge terms live in this browser's storage, not the URL. */
export default function PledgePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="wrap page">
      <Suspense fallback={<p className="hint">Loading…</p>}>
        <Inner params={params} />
      </Suspense>
    </main>
  );
}
