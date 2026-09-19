/**
 * Does each component actually render?
 *
 * `next build` compiles a component that throws the moment it is rendered — a
 * dependency array is valid syntax whatever is inside it — so the build alone is
 * not evidence the app works. Texor Talk shipped exactly that once. One render
 * each, no browser needed: React runs every component body during
 * `renderToStaticMarkup`, and effects (the part a server render cannot check
 * anyway) are skipped.
 *
 * A smoke test, not a UI test. It asserts that things render and put their
 * essentials on the page, and nothing about markup in detail — that would break
 * on every design change and teach everyone to ignore it.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./jsx-loader.mjs', pathToFileURL(`${import.meta.dirname}/`));

const { createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

/** Render, and turn a thrown error into a failed assertion rather than a crash. */
function render(label, element) {
  try {
    return renderToStaticMarkup(element);
  } catch (error) {
    check(label, false, `${error.name}: ${error.message}`);
    return null;
  }
}

const NOTE = {
  id: 'n1',
  title: 'Q3 launch',
  preview: 'Ask Bo for the deck',
  stats: { words: 5, highlights: 1, todo: 2, done: 1 },
  colour: 'yellow',
  labels: ['l1'],
  pinned: true,
  shared: true,
  sharedWith: 2,
  isMine: true,
  owner: { texorId: 'tx-ana', name: 'Ana Note' },
  source: { app: 'Acme CRM' },
  blocks: [
    { type: 'heading', text: 'Q3 launch', marks: [], level: 2 },
    { type: 'todo', text: 'send the summary', marks: [], done: true },
  ],
};

const LABELS = [
  { id: 'l1', name: 'Work', colour: 'blue', isMine: true, locked: false },
  { id: 'l2', name: 'Acme CRM', colour: 'default', isMine: true, locked: true },
  { id: 'l3', name: 'Team', colour: 'green', isMine: false, locked: false },
];

console.log('\n── a note on the board ──');
{
  const { NoteCard } = await import('@/components/NoteCard');
  const html = render('the card renders', h(NoteCard, { note: NOTE, labels: LABELS, onOpen: () => {}, onPin: () => {} }));
  if (html) {
    check('the card renders', true);
    check('with its title', html.includes('Q3 launch'));
    check('painted its own colour', html.includes('--note-yellow'));
    check('naming the label it is filed under', html.includes('Work'));
    check('and the app that wrote it', html.includes('Acme CRM'));
    check('with its checklist progress', html.includes('1/2 done'));
  }

  const empty = render('an empty note renders', h(NoteCard, { note: { ...NOTE, title: '', preview: '' }, onOpen: () => {} }));
  if (empty) check('an empty note says so rather than drawing a blank card', empty.includes('Empty note'));
}

console.log('\n── the labels ──');
{
  const { LabelSidebar } = await import('@/components/LabelSidebar');
  const html = render('the sidebar renders', h(LabelSidebar, { labels: LABELS, activeId: 'l1', onCreate: async () => {} }));
  if (html) {
    check('the sidebar renders', true);
    check('marks the open label', html.includes('labels__item--on'));
    check('and quietly says which are shared and which belong to apps',
      html.includes('shared') && html.includes('app'));
  }

  const none = render('no labels renders', h(LabelSidebar, { labels: [], onCreate: async () => {} }));
  if (none) check('no labels explains what they are for', none.includes('found again'));

  const { LabelPicker } = await import('@/components/LabelPicker');
  const picker = render('the label picker renders', h(LabelPicker, { labels: LABELS, selected: ['l1'], onToggle: () => {} }));
  if (picker) {
    check('the picker offers only my own labels', !picker.includes('Team'));
    check("and an app's label cannot be unticked by hand", /disabled[^>]*>?[\s\S]*Acme CRM/.test(picker));
  }
}

console.log('\n── one note, open ──');
{
  const { NoteEditor, NoteBody } = await import('@/components/NoteEditor');
  const editor = render('the editor renders', h(NoteEditor, { note: NOTE, people: [] }));
  if (editor) check('the editor renders', editor.includes('Q3 launch'));

  const body = render('the read-only view renders', h(NoteBody, { blocks: NOTE.blocks }));
  if (body) check('the read-only view shows the checklist as done', body.includes('note__block--done'));

  const { ColourPicker } = await import('@/components/ColourPicker');
  const colours = render('the colours render', h(ColourPicker, { value: 'yellow', onPick: () => {} }));
  if (colours) {
    check('there are nine colours to choose from', (colours.match(/class="swatch[ "]/g) ?? []).length === 9);
    check('and the current one is marked', colours.includes('swatch swatch--on'));
  }

  const { ActivityPanel } = await import('@/components/ActivityPanel');
  const trail = render('the trail renders', h(ActivityPanel, {
    activity: [
      { at: new Date().toISOString(), action: 'edited', actor: { name: 'Bo Reader' } },
      { at: new Date().toISOString(), action: 'shared', detail: 'kim@texor.app', actor: { name: 'Ana Note' } },
    ],
  }));
  if (trail) {
    check('the trail names who did what', trail.includes('Bo Reader') && trail.includes('edited it'));
    check('including who it was shared with', trail.includes('shared it with kim@texor.app'));
  }
  const nothing = render('an empty trail renders', h(ActivityPanel, { activity: [] }));
  if (nothing) check('an empty trail says so', nothing.includes('Nothing yet'));
}

console.log('\n── sharing ──');
{
  const { ShareDialog } = await import('@/components/ShareDialog');
  const shares = [
    { email: 'bo@texor.app', name: 'Bo Reader', role: 'editor', pending: false },
    { email: 'new@texor.app', name: '', role: 'viewer', pending: true },
  ];
  const html = render('the share dialog renders', h(ShareDialog, {
    title: 'Q3 launch', shares, onShare: async () => {}, onUnshare: async () => {}, onClose: () => {},
  }));
  if (html) {
    check('the share dialog renders', true);
    check('it lists who already has it', html.includes('Bo Reader'));
    check('and says plainly when a share is still waiting',
      html.includes('waiting for them to sign in'));
  }

  const alone = render('with no shares yet', h(ShareDialog, {
    title: 'x', shares: [], onShare: async () => {}, onUnshare: async () => {}, onClose: () => {},
  }));
  if (alone) check('with no shares yet it says so', alone.includes('Not shared with anybody yet'));

  const viewer = render('as somebody who cannot share', h(ShareDialog, {
    title: 'x', shares, canShare: false, onShare: async () => {}, onUnshare: async () => {}, onClose: () => {},
  }));
  if (viewer) check('somebody who cannot share is told why instead of shown a form',
    viewer.includes('Only the owner') && !viewer.includes('Remove'));
}

console.log('\n── the API screen ──');
{
  const { ApiKeyManager } = await import('@/components/ApiKeyManager');
  const html = render('the key manager renders', h(ApiKeyManager));
  if (html) {
    check('the key manager renders without a key in hand', html.includes('Create a key'));
    check('and offers both ways a key can own notes', html.includes('Its own users'));
  }
}

console.log('\n── the public page ──');
{
  const { Landing } = await import('@/components/Landing');
  const html = render('the landing page renders', h(Landing));
  if (html) {
    check('the landing page renders', html.includes('Everything you meant to remember'));
    check('and shows the API it is unusual for', html.includes('/api/v1/notes'));
    check('without listing itself among its siblings',
      !/lp__family[\s\S]*Texor Notes<\/a>/.test(html));
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
