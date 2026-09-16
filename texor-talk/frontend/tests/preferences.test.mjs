/**
 * Settings that are actually acted on.
 *
 * ── Why ──
 *
 * Eleven preferences were offered and seven of them were read by nothing. You
 * could pick a microphone, ask to join muted, choose a camera, choose which
 * speakers to listen through, and say whether a shared screen should favour
 * sharpness or smoothness — and every one of those was written to storage and
 * never looked at again. The settings screen worked perfectly; the settings
 * did not exist.
 *
 * The green room was the worst of it, because it is the screen whose entire
 * job is to answer those questions: it opened with the microphone on, the
 * camera on and the system devices every single time.
 *
 * So these check the round trip — what is stored becomes what the green room
 * opens with, and what somebody changes there is what gets stored — including
 * the inversion in the middle of it, which is where a round trip like this
 * usually gets flipped.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const prefs = await import(`${FE}/src/lib/preferences.js`);
const { joinDefaults, joinPatch, DEFAULT_PREFERENCES } = prefs;

let pass = 0, fail = 0;
const check = (l, ok, extra = '') => {
  ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${extra}`));
};

console.log('\n── what the green room opens with ──');
{
  const fresh = joinDefaults(DEFAULT_PREFERENCES);
  check('a new person arrives ready to speak', fresh.micOn === true);
  check('and to be seen', fresh.cameraOn === true);
  check('on whatever the system chose', fresh.chosen.mic === '' && fresh.chosen.camera === '');

  /**
   * The inversion: the stored question is "join muted", the control is
   * "microphone on". Reading one as the other is silent and total — every
   * setting would come back meaning its opposite.
   */
  const quiet = joinDefaults({ joinMuted: true, joinCameraOff: true });
  check('"join muted" opens with the microphone off', quiet.micOn === false);
  check('"join with camera off" opens with the camera off', quiet.cameraOn === false);

  const picked = joinDefaults({ micId: 'mic-7', cameraId: 'cam-2' });
  check('a remembered microphone is selected', picked.chosen.mic === 'mic-7');
  check('and a remembered camera', picked.chosen.camera === 'cam-2');
}

console.log('\n── the two are not confused with each other ──');
{
  // Muting the microphone must not turn the camera off, which is what a copy
  // and paste between these two lines produces.
  const mutedOnly = joinDefaults({ joinMuted: true });
  check('joining muted leaves the camera alone', mutedOnly.micOn === false && mutedOnly.cameraOn === true);

  const darkOnly = joinDefaults({ joinCameraOff: true });
  check('joining dark leaves the microphone alone', darkOnly.micOn === true && darkOnly.cameraOn === false);
}

console.log('\n── what gets stored when it is changed ──');
{
  check('turning the microphone off stores "join muted"',
    joinPatch({ micOn: false }).joinMuted === true);
  check('turning it on clears it', joinPatch({ micOn: true }).joinMuted === false);
  check('and the camera the same way',
    joinPatch({ cameraOn: false }).joinCameraOff === true && joinPatch({ cameraOn: true }).joinCameraOff === false);

  check('choosing a device stores its id', joinPatch({ chosen: { mic: 'mic-7' } }).micId === 'mic-7');

  // "System default" has to be storable, or somebody who picks a device can
  // never go back to letting the machine decide.
  check('choosing the default stores nothing rather than an empty string',
    joinPatch({ chosen: { mic: '' } }).micId === null);
  check('and the same for the camera', joinPatch({ chosen: { camera: '' } }).cameraId === null);

  /**
   * A patch is merged over everything else that is stored, so it must only
   * mention what actually changed — a key present with `undefined` would erase
   * a setting nobody touched.
   */
  check('changing the microphone mentions only the microphone',
    Object.keys(joinPatch({ micOn: false })).join(',') === 'joinMuted');
  check('changing one device mentions only that device',
    Object.keys(joinPatch({ chosen: { camera: 'cam-1' } })).join(',') === 'cameraId');
  check('changing nothing stores nothing', Object.keys(joinPatch({})).length === 0);
  check('and no argument at all is not an error', Object.keys(joinPatch()).length === 0);
}

console.log('\n── the round trip ──');
{
  // The property the whole feature rests on: whatever the green room is left
  // in is what it opens with next time.
  const cases = [
    { micOn: true, cameraOn: true, chosen: { mic: '', camera: '' } },
    { micOn: false, cameraOn: true, chosen: { mic: 'mic-1', camera: '' } },
    { micOn: true, cameraOn: false, chosen: { mic: '', camera: 'cam-9' } },
    { micOn: false, cameraOn: false, chosen: { mic: 'mic-3', camera: 'cam-4' } },
  ];

  let bad = '';
  for (const state of cases) {
    const stored = { ...DEFAULT_PREFERENCES, ...joinPatch(state) };
    const reopened = joinDefaults(stored);

    const same =
      reopened.micOn === state.micOn &&
      reopened.cameraOn === state.cameraOn &&
      reopened.chosen.mic === state.chosen.mic &&
      reopened.chosen.camera === state.chosen.camera;

    if (!same) bad = `${JSON.stringify(state)} → ${JSON.stringify(reopened)}`;
  }

  check('every combination comes back as it was left', bad === '', bad);
}

console.log('\n── nothing sensible to work with ──');
{
  check('no stored preferences still gives a usable state',
    joinDefaults({}).micOn === true && joinDefaults({}).chosen.mic === '');
  check('null does too', joinDefaults(null).cameraOn === true);
  check('and a stored shape from an older version is filled in',
    joinDefaults({ micId: 'x' }).cameraOn === true);

  // A key added later must not come back undefined for somebody upgrading.
  const partial = { ...DEFAULT_PREFERENCES };
  delete partial.joinCameraOff;
  check('a missing key falls back to the default rather than undefined',
    joinDefaults(partial).cameraOn === true);
}

console.log('\n── every setting is read by something ──');
{
  /**
   * The check that would have caught all of this.
   *
   * A preference nobody consumes is a control that does nothing, and there is
   * no way to tell from the settings screen — it toggles, it saves, it comes
   * back. So each key has to be named somewhere outside the file that defines
   * it and the dialog that sets it.
   */
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const SRC = join(FE, 'src');
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(entry)) files.push(full);
    }
  }(SRC));

  const consumers = files
    .filter((file) => !file.endsWith('lib/preferences.js') && !file.endsWith('SettingsDialog.js'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  /**
   * Four of them reach the app through `joinDefaults`/`joinPatch` rather than
   * by name, because the green room deals in "microphone on" and the store
   * deals in "join muted". They count as consumed only while those helpers are
   * actually called somewhere — otherwise the indirection would be a hiding
   * place for exactly the deadness this is looking for.
   */
  const VIA_HELPER = {
    joinMuted: 'joinDefaults', joinCameraOff: 'joinDefaults',
    micId: 'joinDefaults', cameraId: 'joinDefaults',
  };

  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    const helper = VIA_HELPER[key];
    const named = consumers.includes(key);
    const viaHelper = Boolean(helper) && consumers.includes(helper);

    check(`${key} is acted on somewhere`, named || viaHelper,
      'offered in settings and read by nothing');
  }

  // And the helpers really do cover the keys they are credited with, so a key
  // cannot be excused by a helper that has stopped mentioning it.
  const source = readFileSync(join(SRC, 'lib', 'preferences.js'), 'utf8');
  const helperBody = source.slice(source.indexOf('export function joinDefaults'));
  for (const key of Object.keys(VIA_HELPER)) {
    check(`${key} is handled by the helper it is credited to`, helperBody.includes(key));
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
