/**
 * Rebuilds whisper.cpp for the CPU it is going to run on.
 *
 *   npm run captions:build
 *
 * ── Why this is not optional ──
 *
 * `smart-whisper`'s own `binding.gyp` passes no instruction-set flags, so a
 * default `npm install` compiles ggml's scalar fallback kernels even on a
 * machine with AVX2 sitting idle. The difference is not a few per cent.
 * Measured on a six-core i7-9750H, transcribing the same 4.4 second clip:
 *
 *   stock build      15.5s   — 3.5x slower than the speech it is transcribing
 *   with AVX2/FMA     1.5s   — 2.9x faster than real time
 *
 * A caption layer at the first number does not work: utterances arrive faster
 * than they can be recognised and the queue spends the meeting shedding them.
 * At the second it keeps up with a room. So the flags are the feature.
 *
 * ── Why the binary is not portable afterwards ──
 *
 * `-mavx2` lets the compiler emit instructions that a CPU without AVX2 will
 * refuse with SIGILL. That is safe here because this script builds on the
 * machine that will run it, which is the normal case for a self-hosted
 * product. Building inside a container that is then shipped to older hardware
 * is the case it is not safe for, and `WHISPER_BUILD_FLAGS` is the way out:
 * set it to something conservative, or to `-O3` alone.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { arch, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE = join(BACKEND, 'node_modules', 'smart-whisper');

if (!existsSync(PACKAGE)) {
  console.error(
    '\n  smart-whisper is not installed.\n' +
    '  It is an optional dependency, so `npm install` skips it when the machine\n' +
    '  has no C++ toolchain. Install cmake and a compiler, then `npm install`.\n',
  );
  process.exit(1);
}

/**
 * What this CPU can be told to use.
 *
 * Read from the processor rather than assumed from the architecture: plenty of
 * x86-64 machines in service predate AVX2, and compiling it for them produces
 * something that installs cleanly and then dies on the first utterance.
 */
function detectFlags() {
  if (process.env.WHISPER_BUILD_FLAGS) {
    return process.env.WHISPER_BUILD_FLAGS.split(/\s+/).filter(Boolean);
  }

  const flags = ['-O3'];

  if (arch() === 'arm64') {
    // NEON is part of the baseline on every arm64 target, and on Apple silicon
    // the heavy lifting goes to Metal and Accelerate, which the package already
    // links. There is nothing useful to add.
    return flags;
  }

  let features = '';
  try {
    if (process.platform === 'darwin') {
      features = [
        execFileSync('sysctl', ['-n', 'machdep.cpu.features'], { encoding: 'utf8' }),
        execFileSync('sysctl', ['-n', 'machdep.cpu.leaf7_features'], { encoding: 'utf8' }),
      ].join(' ');
    } else if (process.platform === 'linux') {
      features = execFileSync('grep', ['-m1', '^flags', '/proc/cpuinfo'], { encoding: 'utf8' });
    }
  } catch {
    // Unreadable is the same as absent: build the portable thing.
    return flags;
  }

  const has = (name) => new RegExp(`\\b${name}\\b`, 'i').test(features);

  if (has('avx2')) flags.push('-mavx2');
  if (has('fma')) flags.push('-mfma');
  if (has('f16c')) flags.push('-mf16c');
  else if (has('avx')) flags.push('-mavx');

  return flags;
}

const flags = detectFlags();

console.log(`\n  rebuilding whisper.cpp`);
console.log(`  cpu    : ${cpus()[0]?.model ?? arch()}`);
console.log(`  flags  : ${flags.join(' ')}`);
console.log(`  this takes a minute or two\n`);

try {
  /**
   * `npm rebuild` rather than calling node-gyp directly.
   *
   * node-gyp is not a dependency of this project and is not on the path — npm
   * bundles its own copy and uses it for exactly this. Going through npm is
   * what makes the script work on a clean checkout instead of only on a
   * machine that happens to have node-gyp installed globally.
   */
  execFileSync(
    'npm',
    ['rebuild', 'smart-whisper', '--foreground-scripts'],
    {
      cwd: BACKEND,
      stdio: 'inherit',
      env: { ...process.env, CFLAGS: flags.join(' '), CXXFLAGS: flags.join(' ') },
    },
  );
} catch (error) {
  console.error(`\n  the rebuild failed: ${error.message}`);
  console.error('  captions will still work, just far slower than real time.\n');
  process.exit(1);
}

console.log('\n  whisper.cpp rebuilt for this machine\n');
