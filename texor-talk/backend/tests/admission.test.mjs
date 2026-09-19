/**
 * Who comes into a meeting, and whether they knock.
 *
 * Pure: no database, no server. Every row of the rule table in
 * `services/admission.service.js`, checked against a real Meeting document so
 * `roleOf`, `isRemoved` and `hasBeenAdmitted` are the ones production uses.
 *
 * The reported bug is the first thing checked: "Everyone knocks" has to hold a
 * signed-in colleague at the door — and so does every other label, or the host
 * cannot know what they chose.
 */
const { default: Meeting } = await import('../src/models/Meeting.js');
const { admissionFor, isStricterLobby, isNarrowerAccess } = await import('../src/services/admission.service.js');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const POLICY = { allowExternalGuests: true, forceLobbyForExternal: true };
// Two domains are "ours"; anything else is outside.
const outside = (email) => !/@(texor\.app|texor\.dev)$/.test(String(email ?? ''));
const nobodyOutside = () => false;

const meeting = (extra = {}) => new Meeting({
  code: 'abc-defg-hij', title: 't', hostTexorId: 'tx-host', createdBy: 'tx-host',
  access: 'texor', lobby: 'external', ...extra,
});

const host = { texorId: 'tx-host', email: 'host@texor.app' };
const colleague = { texorId: 'tx-col', email: 'col@texor.app' };
const invitee = { texorId: 'tx-inv', email: 'inv@texor.app' };
const outsider = { texorId: 'tx-out', email: 'sam@gmail.com' };
const guest = { texorId: 'guest:abc', email: '', isGuest: true };

const decide = (m, user, isExternalEmail = outside, policy = POLICY) =>
  admissionFor({ meeting: m, user, policy, isExternalEmail });

console.log('\n── everyone knocks ──');
{
  const m = meeting({ lobby: 'everyone', invitees: [{ texorId: 'tx-inv', email: 'inv@texor.app' }] });
  check('a signed-in colleague knocks — the reported bug', decide(m, colleague).outcome === 'knock');
  check('an invitee knocks too: everyone means everyone', decide(m, invitee).outcome === 'knock');
  check('the host walks in', decide(m, host).outcome === 'admit');

  m.cohostTexorIds.push('tx-col');
  check('a co-host walks in', decide(m, colleague).outcome === 'admit');

  const standIn = meeting({ lobby: 'everyone', actingHostTexorId: 'tx-col' });
  check('whoever is standing in for the host walks in', decide(standIn, colleague).outcome === 'admit');
}

console.log('\n── people outside your organisation knock ──');
{
  const m = meeting({ lobby: 'external' });
  check('an uninvited colleague walks in', decide(m, colleague).outcome === 'admit', decide(m, colleague).why);
  check('an account on an outside domain knocks', decide(m, outsider).outcome === 'knock');
  check('a guest with no account knocks', decide(meeting({ lobby: 'external', access: 'anyone' }), guest).outcome === 'knock');
  check('with no org domains set, nobody with an account is outside',
    decide(m, outsider, nobodyOutside).outcome === 'admit');
}

console.log('\n── off ──');
{
  const m = meeting({ lobby: 'off' });
  check('a colleague walks in', decide(m, colleague).outcome === 'admit');
  // forceLobbyForExternal: the organisation can hold outsiders even when the
  // host turned the waiting room off.
  check('an outsider still knocks when the organisation says so', decide(m, outsider).outcome === 'knock');
  check('and walks in when it does not',
    decide(m, outsider, outside, { ...POLICY, forceLobbyForExternal: false }).outcome === 'admit');
}

console.log('\n── a pass for this sitting ──');
{
  const m = meeting({ lobby: 'everyone', admittedTexorIds: ['tx-col'] });
  check('somebody already let in during this sitting walks back in', decide(m, colleague).outcome === 'admit');
  check('and it is recorded as why', decide(m, colleague).why === 'admitted-this-sitting');
}

console.log('\n── who can join ──');
{
  const invitedOnly = meeting({ access: 'invited', lobby: 'off', invitees: [{ texorId: 'tx-inv', email: 'inv@texor.app' }] });
  check('only people I invite: a stranger is refused', decide(invitedOnly, colleague).outcome === 'refuse');
  check('an invitee is not', decide(invitedOnly, invitee).outcome === 'admit');
  check('an invitee matched by email is not either',
    decide(invitedOnly, { texorId: 'tx-new', email: 'INV@texor.app' }).outcome === 'admit');

  const accounts = meeting({ access: 'texor', lobby: 'off' });
  check('a Texor Account meeting refuses a guest pass', decide(accounts, guest).outcome === 'refuse');
  check('so a pass from when it was open stops working the moment it is closed',
    /Texor Account/.test(decide(accounts, guest).reason ?? ''));

  const forbidden = meeting({ access: 'anyone', lobby: 'off' });
  check('an outsider is refused where the organisation forbids them',
    decide(forbidden, outsider, outside, { ...POLICY, allowExternalGuests: false }).outcome === 'refuse');
}

console.log('\n── refusals come first ──');
{
  const removed = meeting({ lobby: 'off', removedTexorIds: ['tx-col'], admittedTexorIds: ['tx-col'] });
  check('removal beats a pass', decide(removed, colleague).outcome === 'refuse');

  const cancelled = meeting({ status: 'cancelled' });
  check('a cancelled meeting refuses even its host', decide(cancelled, host).outcome === 'refuse');
}

console.log('\n── tightening ──');
{
  check('off → everyone is stricter', isStricterLobby('everyone', 'off'));
  check('external → everyone is stricter', isStricterLobby('everyone', 'external'));
  check('everyone → off is not', !isStricterLobby('off', 'everyone'));
  check('anyone → texor narrows who can join', isNarrowerAccess('texor', 'anyone'));
  check('texor → anyone does not', !isNarrowerAccess('anyone', 'texor'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
