/**
 * Who may do what to a note.
 *
 * Pure: no database, no HTTP. The rules are plain functions over plain objects
 * precisely so they can be checked like this — a permission model that can only
 * be exercised through six HTTP calls is a permission model nobody re-reads.
 */
const HERE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { roleOf, canRead, canWrite, isOwner } = await import(`${HERE}/src/services/access.service.js`);

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  ok ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label} ${extra}`));
};

const ana = { texorId: 'tx-ana' };
const bo = { texorId: 'tx-bo' };
const key = { texorId: 'tx-ana', viaApiKey: true };

const note = (extra = {}) => ({
  ownerTexorId: 'tx-ana',
  shares: [],
  labels: [],
  mentionedTexorIds: [],
  deletedAt: null,
  ...extra,
});

console.log('\n── the owner ──');
{
  check('can do everything', roleOf(note(), ana) === 'owner');
  check('and is still the owner of a note in the trash',
    roleOf(note({ deletedAt: new Date() }), ana) === 'owner');
  check('nobody signed in is nobody', roleOf(note(), {}) === null);
}

console.log('\n── being shared a note ──');
{
  const shared = note({ shares: [{ texorId: 'tx-bo', email: 'bo@texor.app', role: 'editor' }] });

  check('an editor can rewrite it', canWrite(shared, bo));
  check('but is not its owner', !isOwner(shared, bo));

  const viewing = note({ shares: [{ texorId: 'tx-bo', email: 'bo@texor.app', role: 'viewer' }] });
  check('a viewer can read it', canRead(viewing, bo));
  check('and cannot change a word', !canWrite(viewing, bo));

  const pending = note({ shares: [{ texorId: null, email: 'bo@texor.app', role: 'editor' }] });
  check('a share waiting on an email grants nothing yet', roleOf(pending, bo) === null);
}

console.log('\n── being shared a label ──');
{
  const filed = note({ labels: ['lab-1'] });
  const labelRoles = new Map([['lab-1', 'editor']]);

  check('reaches every note filed under it', canWrite(filed, bo, { labelRoles }));
  check('and stops at the ones that are not',
    roleOf(note({ labels: ['lab-2'] }), bo, { labelRoles }) === null);

  // A note can be filed twice and shared directly. The strongest wins, or
  // filing a note under a second label could quietly demote a collaborator.
  const both = note({
    labels: ['lab-1'],
    shares: [{ texorId: 'tx-bo', email: 'bo@texor.app', role: 'viewer' }],
  });
  check('the strongest of the two roles is the one that applies',
    roleOf(both, bo, { labelRoles }) === 'editor');
}

console.log('\n── being mentioned ──');
{
  // Inherited from Texor Talk, and worth restating: typing somebody's name must
  // not publish a note you thought was yours.
  const mentioning = note({ mentionedTexorIds: ['tx-bo'] });
  check('gets you nothing at all', roleOf(mentioning, bo) === null);
  check('not even a read', !canRead(mentioning, bo));
}

console.log('\n── the trash ──');
{
  const binned = note({
    deletedAt: new Date(),
    shares: [{ texorId: 'tx-bo', email: 'bo@texor.app', role: 'editor' }],
  });

  check('a trashed note belongs to its owner alone', roleOf(binned, bo) === null);
  check('and the owner still has it', roleOf(binned, ana) === 'owner');
}

console.log('\n── an API key ──');
{
  check('acts as the account it writes into', roleOf(note(), key) === 'owner');

  // A key was given the right to put notes somewhere, not the right to read
  // everything its owner has ever been shown.
  const sharedWithAna = {
    ownerTexorId: 'tx-someone-else',
    shares: [{ texorId: 'tx-ana', email: 'ana@texor.app', role: 'editor' }],
    labels: [], mentionedTexorIds: [], deletedAt: null,
  };
  check("and never inherits that account's invitations", roleOf(sharedWithAna, key) === null);
  check('though the person themselves still has it', roleOf(sharedWithAna, ana) === 'editor');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
