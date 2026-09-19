# How notes work

The decisions this product rests on, and why.

---

## The document is Texor Talk's

A note is blocks of plain text with `{ start, end, type }` mark ranges over
them — never HTML. The model, the sanitiser, the editor, autosave and all five
exporters were lifted from Texor Talk unchanged. Two reasons:

- They are tested and in production. A second implementation of the same thing
  is a second set of bugs.
- Byte-compatibility is what lets a meeting note cross between the products with
  no mapping layer. The Talk integration is a few functions because of it.

The rule that makes the format safe carries over too: nothing that reaches the
server is markup, nothing that leaves it is markup, and the sanitiser clamps
rather than refuses — a mark one character past the end of its text is a
keystroke racing a save, not an attack.

One trap is inherited with it. The editor's `writeBlock` and `readBlock` handle
`code`, `italic`, `bold`, `highlight` and `mention`. The stored format also
allows `underline`, `strike`, `color` and `link`. Any toolbar button added for
those needs a matching case in both functions, or the next keystroke silently
drops the mark — `readBlock` reconstructs the block from the DOM, and what it
cannot see ceases to exist.

## Who may do what

All of it is in `backend/src/services/access.service.js`. A role is the strongest
of three things: owning the note, a share on the note, and a share on any label
the note is filed under.

| | read | edit | share | trash |
|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ |
| editor | ✓ | ✓ | | |
| viewer | ✓ | | | |
| mentioned only | | | | |

- **Being mentioned grants nothing.** Tagging somebody is a reference, not an
  invitation; otherwise typing a name could publish a note you thought was
  yours.
- **A note in the trash belongs to its owner alone**, and nobody can write to
  it — that is the autosave in flight when delete was pressed, which would
  otherwise recreate the note a second later.
- **An API key acts as the account it writes into**, but never inherits that
  account's invitations.

## Sharing a label

A shared label carries everything filed under it. A note gains collaborators
when it is filed and loses them when it is unfiled — which is how a team works
on "Q3 launch" rather than on eleven separate notes. Only the owner's own labels
can be put on a note: filing a note under somebody else's shared label would
share it with everybody that label reaches.

## Sharing with somebody who is not here yet

Sharing is by email. If nobody has signed in with that address, the share is
stored with no `texorId` and the first sign-in claims it. No invitation token,
nothing to expire, no mail server on the path.

There is no directory. Texor Account does not publish one, and this product does
not build a way to list everybody in an organisation: the share dialog suggests
people you already share with, and resolves an exact address.

## Two people, one note

A save replaces the whole document; merging two rich documents is a research
problem. So every note carries a `version`, every document save says which
version it was made against, and a stale one is refused with `409` and the
current note attached. The editor keeps the person's words on screen and offers
both versions — it never picks one on a timer.

Pinning, colour and archiving skip the check. They cannot lose a word, and
refusing them would make a shared note feel broken for nothing.

An open shared note asks for changes every eight seconds while it is visible,
and only applies them when nothing local is waiting to be saved.

## The trail

`noteevents` records who created, edited, shared, labelled, archived, trashed
or restored a note, and when. A burst of autosaves by one person is one row.
It is not a version history: it says a note was edited, not what it said
before.

## Texor Talk

When Talk is configured with a trusted key (see
[getting started](./getting-started.md#5-connect-texor-talk-optional)):

- A saved meeting note is pushed here after Talk's response has gone. It lands
  in the account of **whoever wrote it**, under their own "Texor Talk" label,
  even if they have never opened Notes.
- An edit, trash or restore made here is posted back to Talk, signed. Talk
  verifies the signature over the raw bytes before applying it.
- A change that arrived from the other product is never sent back to it, on
  either side. That is the whole of the loop prevention.
- Neither direction is ever awaited by a request. Each product saves whether or
  not the other is up.

Without the three `NOTES_*` variables in Talk, none of this happens and Talk is
exactly the product it was.

## What is not here

- Live cursors and simultaneous typing — that needs a CRDT and a socket server
- Version history and restoring an old version
- Reminders, images and attachments
- Nested labels
- Email when something is shared — a pending share resolves at next sign-in
- Prefix search — Mongo's text index matches whole, stemmed words
