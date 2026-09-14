# Texor Payroll data model

Four collections in the `payroll` database.

## `users`

A local projection of a Texor Account — the employer running payroll.

| Field | Notes |
|---|---|
| `texorId` | The `sub` claim. The same value in Finvoice and Talk for the same person |
| `email`, `displayName`, `picture` | Cached from the ID token |
| `companyName`, `payCurrency`, `payFrequency` | Payroll's own settings |

## `sessions`

Payroll's own session — an opaque `payroll_sid` cookie, with the Texor tokens
held server-side. See [texor-sso.md](./texor-sso.md).

## `employees`

| Field | Notes |
|---|---|
| `owner` → `users`, `ownerTexorId` | Every query filters on `owner` |
| `texorId` | **Nullable.** Set only if this employee also has a Texor Account |
| `firstName`, `lastName`, `email` | |
| `jobTitle`, `department` | |
| `annualSalary` | Gross, in the employer's pay currency |
| `taxRate`, `pensionRate` | Percentages |
| `startDate`, `endDate` | |
| `status` | `active` · `on_leave` · `terminated` — only `active` employees enter a run |

### Why `texorId` is nullable

Most employees are just records. Linking one to a Texor Account is what would
let that person sign in and see their own payslips — without being given access
to the whole payroll. The field is the hook for that; the feature is not built
yet.

## `payRuns`

| Field | Notes |
|---|---|
| `owner` → `users`, `ownerTexorId` | |
| `label` | `March 2026` |
| `periodStart`, `periodEnd`, `payDate` | |
| `frequency` | `weekly` · `fortnightly` · `monthly` |
| `currency` | |
| `status` | `draft` · `approved` · `paid` |
| `approvedAt` | |
| `payslips[]` | Embedded — see below |
| `totalGross`, `totalTax`, `totalPension`, `totalNet` | |

Each embedded payslip holds `employee`, `employeeName`, `jobTitle`, `gross`,
`tax`, `pension`, `net`.

### Why payslips are embedded, not referenced

They are only ever read with their run, so a reference would buy nothing and
cost a join.

More importantly, they are **frozen copies**. `employeeName` and every figure
are written once and never recomputed. Giving someone a pay rise tomorrow must
not rewrite what they were paid last month, and a departed employee's payslip
must survive their removal from the register. A reference into `employees`
would quietly break both.

### Why the calculation is a static, not a hook

`PayRun.buildPayslips()` is called explicitly — on creation, and on an explicit
recalculate of a draft. A `pre('save')` hook would recompute the run every time
the document was touched, including when marking it paid, which is exactly the
bug this design exists to prevent.

`recalculatePayRun` refuses to run on anything but a draft. Approval is the
point of no return.

### Indexes

- `{ owner: 1 }` on both collections — the scoping filter
- `{ status: 1 }` on employees — the active-employee query a run is built from
