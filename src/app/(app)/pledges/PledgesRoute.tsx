'use client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePledges } from '@/lib/usePledges';
import { PledgeList } from './PledgeList';
import { PledgeStatus } from './PledgeStatus';
import { RenderBoundary } from '@/components/RenderBoundary';

/** /pledges lists this browser's pledges; /pledges?id=<id> (legacy) shows one, same as /pledges/<id>. */
export function PledgesRoute() {
  const id = useSearchParams().get('id');
  const pledges = usePledges();
  if (id) return <PledgeById id={id} />;
  if (pledges === null) return <p className="hint">Loading…</p>;
  return <PledgeList pledges={pledges} />;
}

export function PledgeById({ id }: { id: string }) {
  const pledges = usePledges();
  if (pledges === null) return <p className="hint">Loading…</p>;
  const pledge = pledges.find((p) => p.id === id);
  if (!pledge) {
    return (
      <div className="empty" style={{ marginTop: 32 }}>
        <h1 style={{ marginTop: 0 }}>Pledge not found</h1>
        <p>Pledges are saved in the browser that created them. <Link href="/pledges">See your pledges</Link>.</p>
      </div>
    );
  }
  return (
    <RenderBoundary
      key={pledge.id}
      label="Pledge status"
      fallback={
        <div className="empty" style={{ marginTop: 32 }}>
          <h1 style={{ marginTop: 0 }}>{pledge.promise}</h1>
          <p>This pledge couldn’t be shown. Your coins are safe in its contract on Bitcoin Cash. Reload to try again, or <Link href="/pledges">see your pledges</Link>.</p>
        </div>
      }
    >
      <PledgeStatus pledge={pledge} />
    </RenderBoundary>
  );
}
