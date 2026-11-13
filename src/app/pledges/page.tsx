import { PledgeList } from './PledgeList';

export default function PledgesPage() {
  return (
    <section className="py-10">
      <h1 className="mb-6 text-3xl font-bold">My pledges</h1>
      <PledgeList />
    </section>
  );
}
