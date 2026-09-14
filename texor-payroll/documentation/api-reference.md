# Texor Payroll API reference

Base URL in development: `http://localhost:4003`

Authentication is the `payroll_sid` cookie, established by the Texor SSO flow.
Browser calls need `credentials: 'include'`.

Every query is scoped to the signed-in Texor account. Payroll is the most
sensitive data in the ecosystem, so that scoping lives in the database query
itself rather than in a check performed afterwards.

---

## Authentication

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/login?returnTo=/pay-runs` | Redirects to Texor |
| `GET` | `/api/auth/callback` | Texor returns here with a code |
| `POST` | `/api/auth/logout` | `{ ok, redirectTo }` |
| `GET` | `/api/auth/me` | `{ user }` or `{ user: null }` |

---

## Employees

### `GET /api/employees`

The register, active first, then by surname.

### `POST /api/employees`

```json
{
  "firstName": "Grace",
  "lastName": "Hopper",
  "email": "grace@example.com",
  "jobTitle": "Engineer",
  "department": "Platform",
  "annualSalary": 120000,
  "taxRate": 25,
  "pensionRate": 5,
  "status": "active"
}
```

`annualSalary` is gross, in the employer's pay currency. Rates are percentages.

### `GET /api/employees/:id`
### `PATCH /api/employees/:id`

Any subset of the create body.

### `DELETE /api/employees/:id`

Removes them from the register. Payslips in existing runs are unaffected — they
are frozen copies, not lookups.

---

## Pay runs

### `GET /api/pay-runs`

Every run, newest pay date first. Payslips are omitted from the list; fetch a
single run for those.

### `POST /api/pay-runs`

```json
{
  "label": "March 2026",
  "periodStart": "2026-03-01",
  "periodEnd": "2026-03-31",
  "payDate": "2026-03-31",
  "frequency": "monthly",
  "currency": "USD"
}
```

Builds a payslip for every **active** employee at that moment. `400` if there
are none, or if the period ends before it starts.

Per employee, where `periods` is 52, 26 or 12:

```
gross   = annualSalary / periods
tax     = gross × taxRate%
pension = gross × pensionRate%
net     = gross − tax − pension
```

Each figure is rounded to cents before the totals are summed.

### `GET /api/pay-runs/:id`

The run with its full payslip list.

### `POST /api/pay-runs/:id/recalculate`

Rebuilds a **draft** from the current register — useful after a pay rise.
`409` on an approved run.

### `POST /api/pay-runs/:id/approve`

`draft` → `approved`, stamps `approvedAt`, and locks the figures permanently.

### `POST /api/pay-runs/:id/mark-paid`

`approved` → `paid`. `409` if the run has not been approved.

### `DELETE /api/pay-runs/:id`

Drafts only. `409` on an approved run — those are a permanent record.

### `GET /api/summary`

```json
{ "summary": { "activeEmployees": 8, "annualPayroll": 640000, "lastRun": { … } } }
```

---

## Health

`GET /api/health` → `{ "status": "ok", "service": "payroll" }`
