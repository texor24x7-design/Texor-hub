import { Caveat } from 'next/font/google';
import '@/styles/landing.css';
import { Landing } from '@/components/landing/Landing';

/**
 * The handwritten aside beside the illustration, and the only typeface this
 * page loads of its own — the product's face comes from the root layout.
 * `next/font` self-hosts it, so the finished page still asks nobody else for
 * anything.
 */
const caveat = Caveat({ subsets: ['latin'], weight: ['600'], variable: '--lp-script', display: 'swap' });

export const metadata = {
  title: 'Texor Finvoice — Bill it. Track it. Get paid.',
  description: 'GST invoices, stock, warranties and staff attendance, in software that arranges itself around your trade. Part of Texor.',
};

/**
 * `/` used to send everybody straight into the app.
 *
 * It is the product's public address, so it is now the public page, and the
 * app entrance moved to `/start` — which signs somebody in through Texor and
 * lands them in their workspace. Nobody meets a sign-in wall before they know
 * what this is.
 */
export default function HomePage() {
  return (
    <div className={caveat.variable}>
      <Landing />
    </div>
  );
}
