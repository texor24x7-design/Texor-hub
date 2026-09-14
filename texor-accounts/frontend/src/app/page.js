import { redirect } from 'next/navigation';

export default function HomePage() {
  // The account console is the only thing hosted at the root of accounts.texor.app.
  redirect('/account');
}
