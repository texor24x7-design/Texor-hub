# Texor Payroll

Payroll runs and payslips for the Texor ecosystem. `payroll.texor.app`

Signs people in with their Texor Account — the same account that opens Finvoice
and Talk.

```
texor-payroll/
├── backend/         Express 5 + MongoDB API        (:4003)
├── frontend/        Next.js 16 app                  (:3003)
└── documentation/   setup, SSO, API, data model
```

## Quick start

Texor Account must be running first — see
[`texor-accounts`](../texor-accounts). Its `npm run seed` prints this product's
client secret.

```bash
cd backend
cp .env.example .env          # paste TEXOR_CLIENT_SECRET from the seed output
npm install
npm run check:texor
npm run dev                   # http://localhost:4003

cd ../frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:3003
```

## What it does

- An employee register: salary, tax rate, pension rate, employment status
- Pay runs that calculate a payslip for every active employee
- Weekly, fortnightly or monthly pay frequencies
- Draft → approved → paid, where approval freezes the figures permanently

## What lives where

| Path | Responsibility |
|---|---|
| `backend/src/texor/` | The Texor SSO client — shared verbatim across every product |
| `backend/src/models/Employee.js` | The employee register |
| `backend/src/models/PayRun.js` | Pay runs, embedded payslips, and the calculation |
| `backend/src/controllers/payrun.controller.js` | Run lifecycle, and the rules that lock an approved run |
| `frontend/src/app/pay-runs/[id]/` | The payslip breakdown |

## Documentation

- [Getting started](./documentation/getting-started.md)
- [Texor SSO](./documentation/texor-sso.md)
- [API reference](./documentation/api-reference.md)
- [Data model](./documentation/data-model.md)
