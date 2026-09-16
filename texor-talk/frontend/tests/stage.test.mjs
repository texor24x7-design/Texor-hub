/**
 * What the stage decides to show.
 *
 * This suite exists because of a crash in front of a user:
 *
 *   Uncaught TypeError: Cannot read properties of undefined (reading 'track')
 *
 * The call view branched `stage.mode === 'grid' ? grid : spotlight`, and the
 * spotlight branch reads `stage.feature.track`. A condition added to the *grid*
 * side sent an empty room down the else path, where there was no feature to
 * read. The build compiled it; nothing could have caught it but running it.
 *
 * So the invariant is stated here and checked against every shape of input:
 * **grid carries no feature, and everything else carries one.**
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { chooseStage, showInviteInstead } = await import(`${FE}/src/lib/stage.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const ME = { texorId: 'me', displayName: 'Me', picture: '' };
const peer = (id, camera = `track-${id}`) => [id, {
  texorId: id, name: id, picture: '', tracks: { camera },
}];
const roomOf = (...ids) => new Map(ids.map((id) => peer(id)));

/** The rule the crash broke. */
const sound = (stage) =>
  (stage.mode === 'grid' ? stage.feature === undefined : Boolean(stage.feature));

console.log('\n── the invariant, over everything ──');
{
  const layouts = ['auto', 'tiled', 'spotlight', 'nonsense'];
  const rooms = [new Map(), roomOf('a'), roomOf('a', 'b'), roomOf('a', 'b', 'c', 'd')];
  const pins = [null, 'me', 'a', 'someone-who-left'];
  const presents = [null, { texorId: 'a', name: 'A', track: 't' }];
  const speakers = [null, 'me', 'a', 'gone'];

  let checked = 0;
  let broken = null;

  for (const layout of layouts) {
    for (const peers of rooms) {
      for (const pinned of pins) {
        for (const presenting of presents) {
          for (const speaking of speakers) {
            const stage = chooseStage({ layout, peers, pinned, presenting, speaking, me: ME });
            checked += 1;
            if (!sound(stage)) {
              broken ??= JSON.stringify({ layout, pinned, speaking, size: peers.size, stage });
            }
          }
        }
      }
    }
  }

  check(`grid never carries a feature, and nothing else is without one (${checked} combinations)`,
    broken === null, broken ?? '');
  check('the search was actually wide', checked === 512, String(checked));
}

console.log('\n── an empty room ──');
{
  // The exact case that crashed: nobody else here, no pin, nobody presenting.
  const stage = chooseStage({ peers: new Map(), me: ME, layout: 'auto' });
  check('falls to the grid', stage.mode === 'grid', JSON.stringify(stage));
  check('and offers nothing to feature', stage.feature === undefined);

  for (const layout of ['tiled', 'spotlight', 'auto']) {
    const alone = chooseStage({ peers: new Map(), me: ME, layout });
    check(`${layout} alone is safe to render`, sound(alone), JSON.stringify(alone));
  }
}

console.log('\n── a pin outranks everything ──');
{
  const peers = roomOf('a', 'b', 'c');
  const presenting = { texorId: 'b', name: 'B', track: 'screen' };

  const stage = chooseStage({ peers, me: ME, pinned: 'a', presenting, speaking: 'c' });
  check('even somebody presenting', stage.reason === 'pinned', JSON.stringify(stage));
  check('and whoever is talking', stage.feature.texorId === 'a');
  check('the pinned camera comes through', stage.feature.track === 'track-a');

  const self = chooseStage({ peers, me: ME, pinned: 'me', localCamera: 'mine' });
  check('pinning yourself works', self.feature.isYou === true && self.feature.track === 'mine',
    JSON.stringify(self.feature));

  // Somebody pinned who then left must not hold an empty stage.
  const gone = chooseStage({ peers, me: ME, pinned: 'someone-who-left' });
  check('a pin on somebody who has gone falls through', sound(gone), JSON.stringify(gone));
  check('rather than featuring nobody', gone.reason !== 'pinned');
}

console.log('\n── presenting ──');
{
  const presenting = { texorId: 'a', name: 'A', track: 'screen' };
  const stage = chooseStage({ peers: roomOf('a', 'b'), me: ME, presenting, layout: 'tiled' });
  check('a shared screen beats the tiled layout', stage.mode === 'present', JSON.stringify(stage));
  check('and is what gets featured', stage.feature.track === 'screen');
}

console.log('\n── automatic ──');
{
  const two = chooseStage({ peers: roomOf('a', 'b'), me: ME, layout: 'auto', speaking: 'a' });
  // Two or three already fit; promoting one loses the others for nothing.
  check('a small room stays a grid even with somebody talking', two.mode === 'grid', JSON.stringify(two));

  const many = chooseStage({ peers: roomOf('a', 'b', 'c'), me: ME, layout: 'auto', speaking: 'b' });
  check('a bigger room promotes the speaker', many.mode === 'feature' && many.feature.texorId === 'b',
    JSON.stringify(many));
  check('for the stated reason', many.reason === 'speaking');

  const quiet = chooseStage({ peers: roomOf('a', 'b', 'c'), me: ME, layout: 'auto' });
  check('with nobody talking it still features somebody', sound(quiet), JSON.stringify(quiet));
}

console.log('\n── spotlight ──');
{
  const one = chooseStage({ peers: roomOf('a'), me: ME, layout: 'spotlight', speaking: 'a' });
  check('spotlight promotes even in a small room', one.mode === 'feature', JSON.stringify(one));

  const speakerGone = chooseStage({ peers: roomOf('a'), me: ME, layout: 'spotlight', speaking: 'gone' });
  check('a speaker who has left does not break it', sound(speakerGone), JSON.stringify(speakerGone));
}

console.log('\n── nothing sensible to work with ──');
{
  check('no arguments at all', sound(chooseStage()));
  check('no identity means a grid', chooseStage({ me: null }).mode === 'grid');
  check('an unknown layout falls back rather than throwing',
    sound(chooseStage({ layout: 'mosaic', peers: roomOf('a'), me: ME })));
  check('a peer with no camera still features',
    chooseStage({ peers: new Map([peer('a', null)]), me: ME, layout: 'spotlight' }).feature.track === null);
}

console.log('\n── when the link replaces the stage ──');
{
  check('alone, camera off, in the call', showInviteInstead({ peerCount: 0, cameraOn: false, status: 'live' }));
  // Camera on and there is something to look at; the tile takes over.
  check('not once the camera is on', !showInviteInstead({ peerCount: 0, cameraOn: true, status: 'live' }));
  check('not once somebody else is here', !showInviteInstead({ peerCount: 1, cameraOn: false, status: 'live' }));
  check('and not before the call is up',
    !showInviteInstead({ peerCount: 0, cameraOn: false, status: 'connecting' }));
  check('no arguments is not "show it"', !showInviteInstead());
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
