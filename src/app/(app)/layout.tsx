import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

// App routes (/create, /pledges, /verify, /verifier-key) share the app header and footer.
// The landing page (/) has its own nav and meadow footer.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
