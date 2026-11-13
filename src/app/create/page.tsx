import { CreatePledgeForm } from './CreatePledgeForm';

export default function CreatePage() {
  return (
    <section className="py-10">
      <h1 className="mb-6 text-3xl font-bold">New pledge</h1>
      <CreatePledgeForm />
    </section>
  );
}
