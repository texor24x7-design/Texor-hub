/**
 * Just enough of Next's build to render a component in plain Node.
 *
 * Two jobs: resolve the `@/` alias the app uses, and transform JSX. Next's own
 * swc binding does the second, so the transform is the same one the real build
 * applies rather than an approximation that could disagree with it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

/**
 * `next/navigation` outside a Next request has no router to give.
 *
 * Components that navigate are otherwise untestable here, which would exempt
 * exactly the ones with the most wiring in them. The stub records nothing and
 * does nothing — this suite asks whether a component renders, not where its
 * buttons go.
 */
const NAVIGATION_STUB = `
  const noop = () => {};
  export const useRouter = () => ({
    push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop,
  });
  export const usePathname = () => '/';
  export const useSearchParams = () => new URLSearchParams();
  export const useParams = () => ({});
  export const redirect = noop;
  export const notFound = noop;
`;

export async function resolve(specifier, context, next) {
  if (specifier === 'next/navigation') {
    return { url: 'stub:next-navigation', format: 'module', shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const base = join(SRC, specifier.slice(2));
    // The app writes `@/lib/api`, not `@/lib/api.js`.
    const path = specifier.endsWith('.js') ? base : `${base}.js`;
    return next(pathToFileURL(path).href, context);
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === 'stub:next-navigation') {
    return { format: 'module', source: NAVIGATION_STUB, shortCircuit: true };
  }

  if (url.startsWith('file://') && url.includes(`${SRC}/`) && url.endsWith('.js')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { code } = transformSync(source, {
      filename: fileURLToPath(url),
      jsc: {
        parser: { syntax: 'ecmascript', jsx: true },
        transform: { react: { runtime: 'automatic' } },
        target: 'es2022',
      },
      module: { type: 'es6' },
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return next(url, context);
}
