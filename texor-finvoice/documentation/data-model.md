# Finvoice data model

Three collections in the `finvoice` database.

## `users`

A local projection of a Texor Account — not a source of identity.

| Field | Notes |
|---|---|
| `texorId` | The `sub` claim. Unique. The same value in Talk and Payroll for the same person |
| `email`, `displayName`, `picture` | Cached from the ID token, refreshed on every sign-in |
| `defaultCurrency`, `businessName` | Finvoice's own settings |
| `lastSeenAt` | |

The cache exists so listing invoices does not mean a call to the identity
provider per row. It is never edited here: profile changes belong at
`accounts.texor.app`.

## `sessions`

Finvoice's own session — how the product remembers that Texor already
authenticated you.

| Field | Notes |
|---|---|
| `user` → `users`, `texorId` | |
| `tokenHash` | SHA-256 of the `finvoice_sid` cookie value |
| `accessToken`, `refreshToken`, `idToken` | `select: false`. Kept server-side so they never reach the browser |
| `accessTokenExpiresAt` | Drives the automatic refresh |
| `expiresAt` | TTL index, 14 days |
| `revokedAt` | Explicit sign-out |

## `invoices`

| Field | Notes |
|---|---|
| `owner` → `users`, `texorId` | Every query filters on `owner` |
| `number` | Unique **per owner**, not globally |
| `client.name`, `.email`, `.address` | |
| `lineItems[]` | `description`, `quantity`, `unitPrice`, `taxRate` |
| `currency`, `notes` | |
| `issueDate`, `dueDate`, `paidAt` | |
| `status` | `draft` · `sent` · `paid` · `overdue` · `void` |
| `subtotal`, `taxTotal`, `total` | **Stored, not computed on read** |

### Why totals are stored

An invoice is a document that was sent to someone. If totals were derived at
read time, changing a tax rate or a rounding rule next year would silently
rewrite what a customer was billed last year. `recalculate()` is the single
place the numbers are derived, and it runs on validation — so they are always
consistent with the line items, but frozen once written.

Rounding is per line, then summed: each line total is rounded to cents before
being added, which avoids the drift you get from summing raw floats across many
items. The frontend preview uses the identical rule so the number never jumps on
save.

### Indexes

- `{ owner: 1, number: 1 }` unique — the per-user number constraint
- `{ owner: 1 }`, `{ status: 1 }` — the list and filter queries
