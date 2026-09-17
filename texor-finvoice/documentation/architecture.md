# Architecture

## Tenancy

A **workspace** is a business. Every record carries `workspace`, and every
query filters on it (`record.service.js`, `document.service.js`). A person's
seat is a **Member** with a role. Routes live under `/api/w/:workspace/…`;
`middleware/workspace.js` resolves the membership and answers 404 — not 403 —
to non-members.

Invitations are Members without a `user`. They are claimed on sign-in **only
when Texor reports the email as verified** — otherwise registering someone's
address would open their employer's books.

## Access control

A role grants `view create edit delete export approve` per module, with
`'*'` for everything and `custom` for modules a workspace defines. `scope:
'own'` narrows a grant to records the member created. `hiddenFields` removes
fields (e.g. purchase price) **from API responses**, not just from screens.
Owners bypass the grid, so no edit can lock a workspace out.

`approve` is each module's irreversible step: issuing or voiding an invoice,
deciding a quotation, marking other people's attendance, resolving claims.

## The metadata engine

`modules/registry.js` defines what each module *is*: its actions and the
fields the code depends on. A workspace stores only what people may change —
names, icons, order, on/off, field labels, help, sections, requiredness,
options, and fields they added. `metadata.service.js` merges the two at read
time, so a field the code starts relying on appears in every workspace without
a migration, and nobody can edit away a field's type.

From the merged fields it compiles a zod validator per module (cached by
`workspace.metadataVersion`). System fields are real columns; custom values
live in `record.custom`. Custom modules (`c_*`) store everything in the generic
`Record` collection and get list, board, form, detail, CSV and — with a
`toInvoice` mapping — "Create invoice".

Settings writes are guarded by `metadataVersion`, so two admins saving at once
get a conflict rather than silently losing one person's changes.

## Documents

Quotations and invoices share `models/document.shared.js`. All money is
**integer paise**. `frontend/src/lib/shared/tax.mjs` computes GST — CGST+SGST
or IGST by place of supply, cess, tax-inclusive prices, line and document
discounts, round-off — and the editor imports the same file, so its live total
is the stored total.

Invoice lifecycle: `draft → issued → partial → paid`, or `void`. **Overdue is
derived** from the due date, never stored. Issuing runs in one transaction:
number from an atomic per-financial-year counter (`INV/26-27/0001`, ≤16
characters), customer and seller snapshots, stock out, a warranty per serial or
unit, receivable updated. Voiding reverses stock and warranties and never
frees the number. Payments use a capped atomic update, so two cashiers cannot
overpay one invoice.

## Designs and PDFs

A design is JSON: page settings plus blocks, each with props, style and a
show-when condition (`designs.mjs`). `render.mjs` is a pure function from
design + document to HTML, escaping everything a person typed and dropping any
style value outside an allow-list. The designer preview, the public link and
the PDF (Puppeteer) all call it. Chromium may only fetch the API's own file and
font routes. Fonts are self-hosted from `@fontsource`, including the latin-ext
subset that carries ₹.

## Files

Uploads go to MongoDB GridFS under a random key. The first bytes must match the
declared type; SVG is refused. Files are served with a sandboxing CSP.
