/**
 * Does each component actually render?
 *
 * ── Why this suite exists ──
 *
 * `next build` compiles the notes editor cleanly while it contained
 * `}, [report, title]);` — a reference to a function that had been deleted.
 * A dependency array is valid syntax whatever is inside it, so the build has
 * nothing to object to, and the first person to open the panel gets
 * `ReferenceError: report is not defined`.
 *
 * Rendering once is what catches that, and it needs no browser: React runs the
 * component body — including every dependency array — during
 * `renderToStaticMarkup`. Effects do not run, so anything touching the DOM is
 * skipped, which is exactly the part a server render cannot check anyway.
 *
 * This is a smoke test, not a UI test. It asserts that components render and
 * put their essentials on the page. It deliberately does not assert markup in
 * detail — that would break on every design change and teach everyone to ignore
 * it.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./jsx-loader.mjs', pathToFileURL(`${import.meta.dirname}/`));

const { createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const editableCount = (html) => (html.match(/contenteditable/gi) ?? []).length;

/** Render, and turn a thrown error into a failed assertion rather than a crash. */
function render(label, element) {
  try {
    return { html: renderToStaticMarkup(element) };
  } catch (error) {
    check(label, false, `${error.name}: ${error.message}`);
    return { html: null };
  }
}

const { NoteEditor, NoteBody } = await import('@/components/NoteEditor');

const PEOPLE = [
  { texorId: 'tx-a', name: 'Ana Note', picture: '', attended: true },
  { texorId: 'tx-b', name: 'Bo Reader', picture: '', attended: true },
];

const NOTE = {
  id: 'n1',
  title: 'Q3 numbers',
  blocks: [
    { type: 'heading', text: 'Revenue', marks: [] },
    {
      type: 'paragraph',
      text: 'Ask @Bo Reader for the deck',
      marks: [
        { type: 'mention', start: 4, end: 14, texorId: 'tx-b', name: 'Bo Reader' },
        { type: 'highlight', start: 19, end: 27, color: 'yellow' },
      ],
    },
    { type: 'todo', text: 'send the summary', marks: [], done: true },
    { type: 'quote', text: 'the margin held up', marks: [], speakerTexorId: 'tx-b', speakerName: 'Bo Reader' },
  ],
};

console.log('\n── the editor renders ──');
{
  const { html } = render('NoteEditor renders at all', h(NoteEditor, { note: NOTE, people: PEOPLE }));
  if (html) {
    check('NoteEditor renders at all', true);
    check('the title is in the document', html.includes('Q3 numbers'), html.slice(0, 200));
    check('there is one editable region per block',
      editableCount(html) === NOTE.blocks.length, String(editableCount(html)));
    check('the block controls are drawn', html.includes('note__rail-btn'));
    check('the checkbox for an action item is drawn', html.includes('note__check'));
    check('the speaker chip is drawn', html.includes('Bo Reader'));
  }
}

console.log('\n── an empty note renders ──');
{
  // The state every new note starts in, and the one most likely to divide by
  // zero somewhere.
  const { html } = render('an empty note renders', h(NoteEditor, { note: { id: 'n2', title: '', blocks: [] }, people: [] }));
  if (html) {
    check('an empty note renders', true);
    check('it still offers somewhere to type', editableCount(html) === 1, String(editableCount(html)));
  }
}

console.log('\n── the editor renders with nothing supplied ──');
{
  // Every prop is optional in practice: the in-call panel mounts it before the
  // people list has arrived.
  const { html } = render('no props at all', h(NoteEditor, {}));
  if (html) check('no props at all', true);

  const { html: compact } = render('compact, no people', h(NoteEditor, { note: NOTE, compact: true }));
  if (compact) check('compact, no people', true);
}

console.log('\n── the read-only view renders ──');
{
  const { html } = render('NoteBody renders', h(NoteBody, { blocks: NOTE.blocks }));
  if (html) {
    check('NoteBody renders', true);
    check('the mention is a chip', html.includes('note-mention'));
    check('the highlight keeps its colour', html.includes('note-highlight--yellow'));
    check('the action item shows as done', html.includes('note__block--done'));
    check('a quote names who said it', html.includes('Bo Reader'));
  }

  const { html: empty } = render('an empty note reads as empty', h(NoteBody, { blocks: [] }));
  if (empty) {
    check('an empty note reads as empty', empty.includes('empty'), empty);
  }
}

console.log('\n── nothing in the document becomes markup ──');
{
  // The whole point of storing ranges rather than HTML. React escapes it, and
  // there is no `dangerouslySetInnerHTML` anywhere in this feature for it to
  // get past.
  const nasty = [{ type: 'paragraph', text: '<img src=x onerror=alert(1)>', marks: [] }];
  const { html } = render('a note full of markup renders', h(NoteBody, { blocks: nasty }));
  if (html) {
    check('a note full of markup renders', true);
    check('it is escaped, not rendered', !html.includes('<img'), html);
    check('and the characters are still there', html.includes('&lt;img'), html);
  }
}

console.log('\n── the meeting timer ──');
{
  const { MeetingTimer } = await import('@/components/MeetingTimer');

  // The clock is fed banked time plus the stretch currently running, not a
  // start time — an empty room must not keep counting.
  const since = new Date(Date.now() - 65_000).toISOString();

  const running = render('a running timer', h(MeetingTimer, { activeSince: since }));
  check('a running timer renders at all', running.html !== '', JSON.stringify(running.html));
  if (running.html) {
    check('a running timer', true);
    check('it shows a clock', /\d+:\d\d/.test(running.html), running.html);
    check('the digits are hidden from screen readers', running.html.includes('aria-hidden="true"'));
    check('but the same fact is available to them', running.html.includes('sr-only'));
    check('with no limit, nothing is said about time left',
      !running.html.includes('meet__left'), running.html);
  }

  // Before anyone joins there is nothing banked and nobody there, so no clock.
  const idle = render('a meeting that has not started', h(MeetingTimer, { activeSince: null }));
  check('a meeting that has not started renders nothing', idle.html === '', JSON.stringify(idle.html));

  /**
   * An empty room that has already run is not the same thing. It holds its
   * total rather than disappearing — a timer that blanked when the last person
   * stepped out would read as the time having been lost rather than paused.
   */
  const held = render('an empty room that has run', h(MeetingTimer, { activeMs: 125_000, activeSince: null }));
  check('an empty room still shows its total', /2:05/.test(held.html), held.html);

  const nearly = render('a meeting near its limit', h(MeetingTimer, {
    activeSince: new Date(Date.now() - 55 * 60_000).toISOString(),
    maxDurationMinutes: 60,
  }));
  check('a meeting near its limit renders', nearly.html !== '', JSON.stringify(nearly.html));
  if (nearly.html) {
    check('a meeting near its limit', true);
    check('it warns', nearly.html.includes('meet__left'), nearly.html);
    check('saying how long is left', nearly.html.includes('left'), nearly.html);
  }

  const over = render('a meeting past its limit', h(MeetingTimer, {
    activeSince: new Date(Date.now() - 90 * 60_000).toISOString(),
    maxDurationMinutes: 60,
  }));
  check('a meeting past its limit renders', over.html !== '', JSON.stringify(over.html));
  if (over.html) {
    check('a meeting past its limit', true);
    check('it says time is up', over.html.includes('Time is up'), over.html);
  }
}

console.log('\n── the live meeting card ──');
{
  const { LiveCard } = await import('@/components/LiveCard');
  const base = {
    code: 'abc-defg-hij',
    title: 'Q3 review',
    participantCount: 3,
    presentCount: 3,
    host: { name: 'Hana Host' },
    startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    // Occupied time, which is what the card shows. `startedAt` above is older
    // than this on purpose: a room that sat empty must not claim the gap.
    activeMs: 0,
    activeSince: new Date(Date.now() - 12 * 60_000).toISOString(),
  };

  const asHost = render('the host sees it', h(LiveCard, {
    meeting: { ...base, viewer: { isHost: true } },
  }));
  if (asHost.html) {
    check('the host sees it', true);
    check('with an End control', asHost.html.includes('dash__card-end'), asHost.html);
    check('and how long it has been running', asHost.html.includes('12 min in'), asHost.html);

    /**
     * The figure is occupied time, not time since it began. A room that ran
     * ten minutes, sat empty for two hours and was reopened used to report
     * itself as two hours old on the card.
     */
    const rested = render('a reopened meeting', h(LiveCard, {
      meeting: {
        ...base,
        viewer: { isHost: true },
        startedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
        activeMs: 10 * 60_000,
        activeSince: null,
      },
    }));
    check('an empty stretch is not counted',
      rested.html.includes('10 min in') && !rested.html.includes('3h'), rested.html);
    // The reason the card stopped being a <button>.
    check('no button is nested inside another',
      !/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(asHost.html), asHost.html);
  }

  const asGuest = render('a participant sees it', h(LiveCard, {
    meeting: { ...base, viewer: { isHost: false } },
  }));
  if (asGuest.html) {
    check('a participant sees it', true);
    // The server refuses them anyway; offering a button that always fails is
    // worse than offering none.
    check('without an End control', !asGuest.html.includes('dash__card-end'), asGuest.html);
    check('but still with a way in', asGuest.html.includes('Join'));
  }

  const bare = render('a card with almost nothing on it', h(LiveCard, {
    meeting: { code: 'x', title: 'Untitled', viewer: {} },
  }));
  if (bare.html) {
    check('a card with almost nothing on it', true);
    check('it says nobody is in rather than "undefined"',
      bare.html.includes('0 in the call'), bare.html);
  }
}

console.log('\n── the landing page ──');
{
  const { Landing } = await import('@/components/Landing');
  const { html } = render('the landing page', h(Landing, {}));

  if (html) {
    check('the landing page', true);
    check('the headline is there', html.includes('Collaborate.'), html.slice(0, 160));
    check('and the line that carries the accent colour',
      html.includes('lp__title-accent'), html.slice(0, 160));
    /**
     * The supplied lockup, used as it was drawn — not the mark with the name
     * set beside it in whatever the interface font happens to be. It was the
     * latter for a while, which meant the wordmark quietly changed shape every
     * time the typeface did.
     */
    check('the brand is the supplied logo file',
      /<img[^>]*class="lp__logo"[^>]*src="\/brand\/talk-logo\.svg"/.test(html), html.slice(0, 400));
    check('and it is not rebuilt out of text beside it',
      !html.includes('lp__wordmark'), 'the wordmark is still being set as type');
    // An image carries no text, so the name has to reach a screen reader some
    // other way or the header becomes an unlabelled link.
    check('the name still reaches assistive tech',
      /class="lp__logo"[^>]*alt="Texor Talk"/.test(html), html.slice(0, 400));
    check('every navigation item is present',
      ['Product', 'Solutions', 'Resources'].every((item) => html.includes(item)));
    check('both calls to action are there',
      html.includes('Start a Meeting') && html.includes('Join with a Code'));
    check('all four features are listed',
      ['HD Video', 'Secure &amp; Encrypted', 'Screen Sharing', 'Team Collaboration']
        .every((item) => html.includes(item)), html.slice(0, 400));
    check('the floating card is drawn', html.includes('lp__badge'));
    check('and the handwritten line', html.includes('Talk beyond boundaries'));
    check('the hero is drawn, not photographed',
      html.includes('lp__doodle') && !html.includes('<img class="lp__photo'), html.slice(0, 400));
    check('and describes itself to a screen reader',
      /class="lp__doodle"[^>]*role="img"[^>]*aria-label="[^"]{15,}"/.test(html)
      || /role="img"[\s\S]{0,120}aria-label="[^"]{15,}"/.test(html), html.slice(0, 700));

    // It belongs to a family, and says so.
    check('the Texor mark is on the page', html.includes('/brand/texor.svg'), html.slice(0, 400));
    check('and links to the account that spans the family',
      /class="lp__family"[^>]*href="[^"]+"/.test(html), html.slice(0, 600));

    // Pricing was removed: there is no billing behind it.
    check('there is no Pricing link', !html.includes('Pricing'), 'Pricing is back');
  }
}

console.log('\n── the landing illustration ──');
{
  const { LandingDoodle } = await import('@/components/LandingDoodle');
  const { HeroDoodle } = await import('@/components/HeroDoodle');
  const landing = render('LandingDoodle', h(LandingDoodle, { className: 'lp__doodle' }));
  const dash = render('HeroDoodle for comparison', h(HeroDoodle, {}));

  if (landing.html && dash.html) {
    check('LandingDoodle', true);
    check('HeroDoodle for comparison', true);
    // Two pages, two drawings. The same one twice would say the landing page
    // and the dashboard are the same screen.
    check('it is a different drawing from the dashboard\u2019s',
      landing.html !== dash.html, 'they are identical');

    check('it says what it is', /aria-label="[^"]{15,}"/.test(landing.html));
    check('it scales', landing.html.includes('viewBox'));
    // The colours come from the page's variables, so the drawing cannot drift
    // away from the brand.
    check('its colours are the family\u2019s, by reference',
      landing.html.includes('var(--tx-'), landing.html.slice(0, 300));

    for (const hook of ['dd-float', 'dd-flow', 'dd-wave', 'dd-spark']) {
      check(`the ${hook} parts are there to animate`, landing.html.includes(hook));
    }
  }
}

console.log('\n── the dashboard illustration ──');
{
  const { HeroDoodle } = await import('@/components/HeroDoodle');
  const { html } = render('HeroDoodle', h(HeroDoodle, { className: 'hero__doodle' }));

  if (html) {
    check('HeroDoodle', true);
    check('it is drawn, not fetched', html.startsWith('<svg') && !html.includes('<img'));
    check('it scales rather than being pinned to a size',
      html.includes('viewBox') && !/<svg[^>]*\swidth="/.test(html), html.slice(0, 120));
    // Decorative to look at, but it still has to say what it is.
    check('it describes itself', /role="img"/.test(html) && /aria-label="[^"]{8,}"/.test(html));

    // The four the brand actually uses, two of them straight off the logo file.
    for (const [name, hex] of [
      ['red', '#fb0102'], ['orange', '#fa5908'], ['green', '#12a05f'], ['yellow', '#f5b800'],
    ]) {
      check(`it carries the brand ${name}`, html.toLowerCase().includes(hex), hex);
    }
    check('and the logo blue', html.toLowerCase().includes('#6187ce'));
  }
}

console.log('\n── the home dashboard ──');
{
  const { default: HomePage } = await import('@/app/home/page');
  // The page wraps itself in AppShell, which fetches the signed-in user, so
  // only the pieces below it can be rendered here. What this asserts instead is
  // that nothing non-functional came back.
  const source = (await import('node:fs')).readFileSync(
    new URL('../src/app/home/page.js', import.meta.url), 'utf8',
  );

  check('the page exists', typeof HomePage === 'function');

  /**
   * Things removed for not working, named so they cannot quietly return.
   *
   * Each was on this page and did nothing: a setup step that could never be
   * completed, a day column that printed "No meetings" eight times, a static
   * tip, and three links of which two pointed at the same wrong page.
   */
  for (const gone of ['Check your microphone', 'Read the docs', 'Explore settings', 'Pro Tip']) {
    check(`"${gone}" is gone`, !source.includes(gone), 'it is back');
  }

  check('nothing links to /notes pretending to be settings',
    !/Explore settings[\s\S]{0,80}\/notes/.test(source));
}

console.log('\n── a section that is not built yet ──');
{
  const { Soon } = await import('@/components/Soon');
  const { CalendarIcon } = await import('@/components/icons');
  const { html } = render('Soon', h(Soon, {
    title: 'Calendar',
    icon: h(CalendarIcon, {}),
    blurb: 'Your meetings laid out by day and week.',
    instead: 'See your meetings',
    insteadHref: '/meetings',
  }));

  if (html) {
    check('Soon', true);
    check('it names the section', html.includes('Calendar'));
    check('it says what the section will do', html.includes('day and week'));
    // The point of the page: it is honest rather than a dead end.
    check('it admits it is not built', /not built yet/i.test(html), html.slice(0, 300));
    check('and always offers a way back to something that works',
      html.includes('See your meetings'));
  }
}

console.log('\n── every other component renders ──');
{
  const { SettingsDialog } = await import('@/components/SettingsDialog');
  const { html } = render('SettingsDialog', h(SettingsDialog, { onClose: () => {} }));
  if (html) check('SettingsDialog', true);

  const { VideoTile } = await import('@/components/VideoTile');
  const tile = render('VideoTile', h(VideoTile, {
    peer: { texorId: 'tx-a', name: 'Ana', picture: '', muted: false, role: 'host' },
  }));
  if (tile.html) check('VideoTile', true);

  const { Logo, LogoIcon } = await import('@/components/ui');
  const logo = render('the app logo', h(Logo, {}));
  if (logo.html) {
    check('the app logo', true);
    check('it uses the supplied logo file too',
      logo.html.includes('/brand/talk-logo.svg'), logo.html);
    check('and is not rebuilt out of text', !logo.html.includes('logo__main'), logo.html);

    /**
     * No dark variant any more.
     *
     * One was offered here and chosen by `prefers-color-scheme` — but that
     * reads the operating system, not this product's stylesheet, so once the
     * app was pinned to light a machine in dark mode got the light-on-dark cut
     * on a white page. The surfaces this sits on are light everywhere now.
     */
    check('it does not follow the operating system\'s theme',
      !/prefers-color-scheme/.test(logo.html), logo.html);

    check('and the whole mark reads as one name', logo.html.includes('Texor Talk'), logo.html);
  }
  const icon = render('the logo on its own', h(LogoIcon, {}));
  if (icon.html) check('the logo on its own', true);

  const ui = await import('@/components/ui');
  const bits = render('the UI kit', h('div', null,
    h(ui.Button, null, 'Press'),
    h(ui.Alert, { kind: 'error' }, 'Broken'),
    h(ui.Field, { label: 'Name', htmlFor: 'x' }, h('input', { id: 'x' })),
    h(ui.Avatar, { user: { displayName: 'Ana', picture: '' } }),
    h(ui.Loading, { label: 'Loading' }),
  ));
  if (bits.html) {
    check('the UI kit', true);
    // The bug that would silently strip every button's styling.
    check('Button keeps its class when given props', bits.html.includes('btn--primary'), bits.html.slice(0, 200));
  }
}

console.log('\n── the start-a-meeting dialog ──');
{
  const { StartMeetingDialog, defaultMeetingTitle } =
    await import('@/components/StartMeetingDialog');

  check('a name is made from the first name',
    defaultMeetingTitle({ displayName: 'Ana Note' }) === "Ana's meeting",
    defaultMeetingTitle({ displayName: 'Ana Note' }));
  // The assumption that has crashed this product before: a display name from an
  // identity provider need not be a string, or be there at all.
  check('and from nothing at all without throwing',
    defaultMeetingTitle({ displayName: { given: 'Ana' } }) === 'New meeting');
  check('nor from no user at all', defaultMeetingTitle() === 'New meeting');

  const { html } = render('the dialog renders', h(StartMeetingDialog, {
    defaultTitle: "Ana's meeting",
    onClose: () => {},
    onStarted: () => {},
  }));
  if (html) {
    check('the dialog renders', true);
    check('it asks who can join', html.includes('Who can join'), html.slice(0, 200));
    check('and about the waiting room', html.includes('Waiting room'));
    // Until the organisation's rules arrive there is no honest value to show,
    // so the field says so and cannot be set to something that will not be sent.
    check('the waiting room waits for the organisation rules',
      html.includes('Checking your organisation') && /<select id="start-lobby"[^>]*disabled/.test(html),
      html.slice(html.indexOf('start-lobby') - 40, html.indexOf('start-lobby') + 400));
    check('the name is filled in already', html.includes("Ana&#x27;s meeting") || html.includes("Ana's meeting"), html.slice(0, 400));
  }

  const channel = render('a channel meeting is pre-set to the channel', h(StartMeetingDialog, {
    defaultTitle: '#design',
    defaultAccess: 'invited',
    channelId: 'c1',
    onClose: () => {},
    onStarted: () => {},
  }));
  if (channel.html) {
    check('a channel meeting is pre-set to the channel', true);
    check('with the access the channel implies',
      channel.html.includes('<option value="invited" selected=""') || channel.html.includes('value="invited" selected'),
      channel.html.slice(0, 600));
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
