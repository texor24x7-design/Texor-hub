# Industry packs

A pack (`backend/src/industries/<key>.js`) is data applied once, when a
workspace is created. Everything it sets is an ordinary setting afterwards, so
a business can undo any of it.

| Key | What makes it feel built for the trade |
|---|---|
| `car_wash` | Job-card board, vehicles, wash packages priced by vehicle type, coating warranties, vehicle no. on bills, tax-inclusive prices |
| `restaurant` | Menu (veg/non-veg, half/full), Bills, Guests, Tables board, 5% GST, thermal receipt |
| `electronics` | Serial-tracked stock, warranty per serial, brand/model, service-request board |
| `salon` | Clients, appointment board, stylist per line item, 5% GST |
| `garage` | Vehicles, job cards with parts and labour, estimates, parts warranties |
| `agency` | Clients, proposals, projects board, invoice ↔ project |
| `retail` | Barcode-first products, MRP on the bill, low-stock alerts, compact design |
| `general` | Every Lite module, neutral defaults |

## Shape

```js
export default {
  key, name, tagline, icon, accent, highlights,
  modules: { customers: { label: 'Guests', order: 30 }, warranties: { enabled: false } },
  fieldOverrides: { products: { trackStock: { default: false } } },
  fields: { invoices: [{ key: 'vehicleNo', label: 'Vehicle no.', type: 'text', printable: true }] },
  customModules: [{
    key: 'c_job_cards', label: 'Job cards', titleField: 'vehicle', boardField: 'stage', customerLink: true,
    toInvoice: { items: ['work'], variantFrom: 'vehicle.vehicleType', fields: { vehicleNo: 'vehicle.regNo' } },
    fields: [/* … */],
  }],
  preferences: { taxRate, priceIncludesTax, units, paymentModes, numbering, design, terms, dashboard },
  sample: { products: [], services: [], records: { c_tables: [] } },
};
```

`toInvoice.variantFrom` follows one reference: a job card's vehicle type picks
the matching price variant of each service.

## Adding a pack

1. Copy `general.js`, fill it in, add it to `industries/index.js`.
2. `npm test -- industries` — it onboards every pack, checks the sidebar,
   custom modules, references and dashboard widgets, and bills and renders an
   invoice from the sample catalogue.

Only put HSN/SAC codes in sample data when you are sure of them; a wrong code on
a real invoice is worse than an empty one.
