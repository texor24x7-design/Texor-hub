# Notes

Notes people take during a meeting, kept afterwards. Tag colleagues with `@`,
attribute a line to whoever said it, highlight what matters.

Every note belongs to **one meeting** and **one author**. Those two facts decide
almost everything else: the meeting supplies the people you can tag and the
people a shared note is shared with, and the author decides the rest.

---

## The document is not HTML

This is the decision the whole feature rests on, so it is worth stating plainly.

A block stores **plain text** plus **marks** — `{ start, end, type }` ranges over
that text:

```js
{
  type: 'paragraph',
  text: 'Ask @Bo Reader for the deck',
  marks: [
    { type: 'mention',   start: 4,  end: 14, texorId: 'tx-bo', name: 'Bo Reader' },
    { type: 'highlight', start: 19, end: 27, color: 'yellow' },
  ],
}
```

The obvious alternative is to take `innerHTML` from a `contentEditable` and
store that. It is also how you end up storing
`<span style="background-color:#ffff00">`, writing a sanitiser for whatever each
browser felt like emitting, and having to be right about it forever.

With ranges there is no markup anywhere in the pipeline. Nothing that arrives at
the server is markup, nothing that leaves it is markup, and each client builds
its own DOM from the ranges. The best an attacker can do is store a note
containing the literal characters `<script>`, which renders as those characters —
there is a test that asserts exactly that.

### Block and mark types

| Block | |
|---|---|
| `paragraph` | the default |
| `heading` | a section |
| `bullet` | list item |
| `todo` | action item, carries `done` |
| `quote` | what somebody said, carries `speakerTexorId`, `speakerName`, `at` |

| Mark | |
|---|---|
| `bold`, `italic`, `code` | presence is all |
| `highlight` | carries a **named** colour: yellow, green, blue, pink, purple |
| `mention` | carries `texorId` and the name as written |

Highlight colours are named, not free-form. A colour a client picks has to
survive a redesign and a dark theme; names let the stylesheet decide what
"yellow" is, and stop a note carrying `#ff00ff` into a palette with no place for
it.

---

## Where the code lives

| | |
|---|---|
| `frontend/src/lib/notes-doc.js` | the model and every editing operation, pure |
| `frontend/src/components/NoteEditor.js` | the editor, and `NoteBody` for reading |
| `backend/src/services/notes.service.js` | the server's own rules |
| `backend/src/controllers/note.controller.js` | access, listing, autosave |

The frontend model and the server's rules overlap, and that is deliberate. The
server must not trust the client's idea of a valid document, so it has to be
able to decide for itself. Deduplicating them would mean the only validation was
the one the attacker controls.

---

## Editing

### React and contentEditable

These two disagree about who owns the DOM, and the usual result is a caret that
jumps to the start of the line on every keystroke.

The rule is that **React never renders a block's content**. Each block is an
empty `contentEditable` div whose children are written imperatively by
`writeBlock`, and that write happens only when the model changed from somewhere
other than typing — loading, formatting, inserting a mention — each of which
bumps the block's `rev`.

Plain typing updates the model and leaves `rev` alone, so the DOM the browser
just edited is never torn down underneath the caret. It also leaves input method
composition alone, which a rewrite-per-keystroke editor breaks for anyone typing
a language that needs it.

### Formatting goes through the model, never `execCommand`

Applying a highlight is:

1. read the block from the DOM (`readBlock`)
2. find the selection as plain-text offsets (`selectionRange`)
3. `toggleMark` on the model — a pure function
4. rebuild the DOM (`writeBlock`) and restore the selection

`document.execCommand('hiliteColor')` would have been two lines, and would have
put browser-chosen markup into storage. Going through the model means the
browser is never asked what a document means, and every formatting rule is
testable without one.

Marks are rebuilt from a per-character view and re-coalesced rather than being
split and merged in place. That is `O(text × marks)` and a note is a few thousand
characters — in exchange it **cannot** produce an overlapping or inverted range,
which is where editors grow their subtlest bugs.

### Rules worth knowing

- **Toggling a partly-marked selection turns it on.** Dragging across a
  half-bold phrase bolds all of it rather than clearing the half that was
  already bold.
- **A second highlight colour replaces the first.** Two colours over one word
  has no meaning anybody could see.
- **A mention is never cut in half.** `snapToMentions` grows a range that lands
  inside one, so highlighting part of a name highlights the name.
- **Paste is always plain text.** Otherwise a note briefly takes on the fonts of
  whatever page it came from, even though `readBlock` would strip them later.
- **A multi-line paste becomes multiple blocks**, because one block is one line.

### Tagging

Typing `@` opens the picker. The query is anchored to the start of a word and
cannot contain spaces:

```
hi @kr     →  picker, query "kr"
(@kr       →  picker
ann@texor.app  →  no picker
```

The email case is the one that matters. Allowing spaces in the query would mean
the picker could never tell `@ann smith` from `@ann` followed by a word, and the
failure mode is a popover that will not go away.

Stored text is `@Their Name`, so a note still reads correctly anywhere the marks
are not rendered — a preview line, a search index, an export.

**Who is offered**: everyone in the meeting's attendance, plus invitees with a
Texor account, plus the host. Inside a call the live roster is merged over the
top so somebody who joined ten seconds ago is taggable without a refetch.
Guests are never offered — a guest is a name typed into a box with no account
behind it, so a mention of one could never resolve to a person.

---

## Who can read a note

| | |
|---|---|
| **Author** | always, and is the only one who can ever write |
| **Anyone else** | only if the author shared it **and** they were in the meeting |

Two consequences that are easy to get wrong:

**Being mentioned grants nothing.** Tagging somebody in a private note is a
reference, not an invitation. The other rule would mean typing a name could
publish a note you thought was yours.

**A shared note is shared with the room, not the organisation.** `visibility:
'meeting'` is checked against that meeting's attendance on every read. Being
invited to a meeting you never turned up to does not hand you the notes other
people took in it.

Reading somebody else's private note is a **404, not a 403**. A 403 confirms the
note exists to anyone holding a guessed id.

Taking a note requires having been in the meeting. Without that check the
meeting code — guessable by design, the way a phone number is — would be enough
to attach a note to a stranger's meeting and have it appear in its shared notes.

Notes need a Texor Account. A guest pass is for one meeting and expires in hours;
a note written under one would belong to nobody the moment it lapsed, and could
never appear in a Notes section the guest has no way to sign back in to.

---

## Saving

`PATCH /api/notes/:id` is an autosave endpoint. It **replaces** the document it
is given rather than merging — merging half-documents from two racing saves is
how an editor loses a paragraph.

The state machine is `lib/autosave.js` — deliberately outside React, so it can
be tested without a browser. `useAutosave` is a thin wrapper that mirrors it into
component state.

It holds three properties:

- **the last edit always gets saved.** A debounce alone drops whatever was typed
  in the final few hundred milliseconds, so the pending draft is kept and
  flushed on unmount, on `pagehide`, and on tab switch.
- **saves do not overlap.** Two in flight can land out of order and the older one
  wins, quietly reverting a paragraph. A save asked for while one is running is
  queued, not started.
- **a failure keeps the draft.** The state goes to `error`, the draft stays
  pending, and it retries. The draft is the only copy there is.

### Why "is anybody listening" is a subscription, not a flag

The first version held a boolean and cleared it in an effect cleanup:

```js
const alive = useRef(true);
useEffect(() => () => { alive.current = false; }, []);   // never set back
```

`reactStrictMode` is on, so React mounts every component twice in development —
effect, cleanup, effect — and nothing ever restored that flag. Every save still
ran; every state update around it was skipped. The indicator sat on **"Unsaved
changes" forever** while the note was saving perfectly, which is the worst
possible way to be wrong about saving: it tells people their work is at risk
when it is not, and trains them to distrust the one indicator that matters.

The fix is not "also set it to true on mount". It is to remove the flag. The
saver exposes `listen(fn)` returning an unsubscribe, and the hook subscribes in
the effect **body** — so a second mount re-attaches, because attaching is what
mounting does. There is no state left to fall out of step.

`listen` also hands the new listener the current state immediately, so a remount
midway through a save shows "Saving…" rather than blank.

Deletes are soft, so an autosave already in flight cannot resurrect a note the
author just deleted.

---

## API

| | |
|---|---|
| `GET /api/notes?scope=…` | `mine`, `mentions`, `shared`, `all`; also `meetingCode`, `q` |
| `GET /api/notes/:id` | one note, with `people` if you can edit it |
| `POST /api/notes` | needs `meetingCode` |
| `PATCH /api/notes/:id` | autosave: `title`, `blocks`, `visibility`, `pinned` |
| `DELETE /api/notes/:id` | soft |
| `GET /api/meetings/:code/people` | who can be tagged, before a note exists |

List rows never carry the document — a title, a preview, and counts is all a
card needs, and a busy meeting produces a lot of notes.

`mentionedTexorIds` is derived from the blocks on every save and indexed. That is
what makes "notes that mention me" one lookup rather than a scan through every
note in the organisation reading its marks. It is never accepted from the
client, so it cannot disagree with the text.

---

## Tests

| | |
|---|---|
| `backend/tests/notes-doc.test.mjs` | the model — no server, no browser |
| `backend/tests/notes.test.mjs` | access, sharing, autosave, what the server refuses |
| `frontend/tests/render.test.mjs` | every component renders at all |
| `frontend/tests/autosave.test.mjs` | coalescing, ordering, retry, and the StrictMode remount |

### `next build` passing is not evidence the app works

This shipped:

```js
}, [report, title]);   // `report` had been deleted
```

The build compiled it happily — a dependency array is valid syntax whatever is
inside it — and the first person to open the Notes panel got
`ReferenceError: report is not defined`.

`frontend/tests/render.test.mjs` renders each component once with
`renderToStaticMarkup`. React runs the component body, including every
dependency array, so that error surfaces immediately. Effects do not run, which
is fine: the DOM-touching half could not be checked without a browser anyway,
and the half that can be checked is now checked on every `npm test`.

It runs from the frontend directory, via a loader that resolves the `@/` alias
and transforms JSX with Next's own swc binding — the same transform the real
build applies, rather than an approximation that could disagree with it.

The first suite is the one to read. Every assertion in it is the same question
in a different shape: after an edit, does each mark still cover the characters it
was describing? A highlight that creeps, a mention that loses its person, a bold
that swallows the next word — none of it needs a browser to catch.

---

## What is not here

**Real-time collaborative editing.** Two people typing into one note needs a
CRDT or operational transform, and pretending otherwise with last-write-wins
would silently destroy work. Notes are single-author and shared when the author
says so, which is a smaller promise that is actually kept.

**Notes not attached to a meeting.** The Notes section groups by the conversation
a note came out of, because "what did we say in the Tuesday review" is the
question people arrive with. A free-floating notes app is a different product.

**Transcription.** A quote block is somebody typing what they heard, attributed
and timestamped. There is no speech-to-text in this product and the UI does not
imply there is.
