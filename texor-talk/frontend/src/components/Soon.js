'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

/**
 * A section that exists in the navigation before it exists in the product.
 *
 * The alternative to this page is a link that 404s, which is worse: a dead end
 * reads as something broken, where this reads as something coming. It says what
 * the section will do rather than "coming soon", so nobody has to guess whether
 * it is the thing they were looking for, and it always offers the way back to
 * something that works.
 */
export function Soon({ title, icon, blurb, instead, insteadHref }) {
  const router = useRouter();

  return (
    <div className="soon">
      <span className="soon__icon" aria-hidden="true">{icon}</span>
      <h1>{title}</h1>
      <p>{blurb}</p>
      <p className="soon__note">Not built yet — this section is on the way.</p>

      {instead ? (
        <Button variant="secondary" onClick={() => router.push(insteadHref)}>{instead}</Button>
      ) : null}
    </div>
  );
}

export default Soon;
