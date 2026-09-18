import { PAYMENT_MODES, options, rs } from './helpers.js';

const vehicleTypes = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Bike'];
const perVehicle = (...prices) => prices.map((price, i) => ({ name: vehicleTypes[i], priceMinor: rs(price) }));

export default {
  key: 'car_wash',
  name: 'Car wash & detailing',
  tagline: 'Job cards, vehicle history and packages priced by vehicle type.',
  icon: 'car',
  accent: '#0f9f7a',
  highlights: ['Live job-card board from waiting to delivered', 'Every wash tied to the vehicle, not just the owner', 'Coating & PPF warranties issued from the bill'],

  modules: {
    dashboard: { order: 0 },
    c_job_cards: { order: 10 },
    customers: { order: 20 },
    c_vehicles: { order: 25 },
    invoices: { order: 30 },
    quotations: { order: 40, label: 'Estimates', labelSingular: 'Estimate' },
    payments: { order: 45 },
    services: { order: 50, label: 'Wash packages', labelSingular: 'Wash package', icon: 'spray-can' },
    products: { order: 55, label: 'Consumables', labelSingular: 'Consumable', icon: 'package' },
    warranties: { order: 60, label: 'Coating warranties', labelSingular: 'Coating warranty' },
    staff: { order: 70 },
  },

  customModules: [
    {
      key: 'c_vehicles', label: 'Vehicles', labelSingular: 'Vehicle', icon: 'car', group: 'sales',
      titleField: 'regNo', customerLink: true,
      fields: [
        { key: 'regNo', label: 'Registration no.', type: 'text', required: true, placeholder: 'MH 12 AB 1234' },
        { key: 'vehicleType', label: 'Type', type: 'select', required: true, options: options(...vehicleTypes) },
        { key: 'make', label: 'Make', type: 'text', placeholder: 'Hyundai' },
        { key: 'model', label: 'Model', type: 'text', placeholder: 'Creta' },
        { key: 'color', label: 'Colour', type: 'text' },
        { key: 'photo', label: 'Photo', type: 'image' },
        { key: 'notes', label: 'Notes', type: 'longtext' },
      ],
    },
    {
      key: 'c_job_cards', label: 'Job cards', labelSingular: 'Job card', icon: 'clipboard-list', group: 'operations',
      titleField: 'vehicle', boardField: 'stage', customerLink: true,
      toInvoice: { items: ['work'], variantFrom: 'vehicle.vehicleType', fields: { vehicleNo: 'vehicle.regNo' } },
      fields: [
        { key: 'vehicle', label: 'Vehicle', type: 'reference', refModule: 'c_vehicles', required: true },
        { key: 'stage', label: 'Stage', type: 'select', required: true, default: 'waiting', options: options('Waiting', 'Washing', 'Detailing', 'Quality check', 'Ready', 'Delivered') },
        { key: 'work', label: 'Packages & add-ons', type: 'items', refModule: 'services' },
        { key: 'assignedTo', label: 'Washer', type: 'reference', refModule: 'staff' },
        { key: 'promisedAt', label: 'Promised by', type: 'datetime' },
        { key: 'beforePhoto', label: 'Before photo', type: 'image', section: 'Condition' },
        { key: 'afterPhoto', label: 'After photo', type: 'image', section: 'Condition' },
        { key: 'damage', label: 'Existing scratches / damage', type: 'longtext', section: 'Condition' },
      ],
    },
  ],

  fields: {
    customers: [{ key: 'membership', label: 'Membership', type: 'select', options: options('None', 'Silver', 'Gold', 'Platinum') }],
    invoices: [{ key: 'vehicleNo', label: 'Vehicle no.', type: 'text', printable: true }],
    quotations: [{ key: 'vehicleNo', label: 'Vehicle no.', type: 'text', printable: true }],
  },

  preferences: {
    taxRate: 18,
    priceIncludesTax: true,
    units: ['Wash', 'Service', 'Pcs', 'Litre'],
    paymentModes: PAYMENT_MODES,
    categories: { services: ['Washing', 'Detailing', 'Coating', 'Add-ons'], products: ['Shampoo & chemicals', 'Microfibre', 'Accessories'] },
    designations: ['Washer', 'Detailer', 'Supervisor', 'Cashier'],
    numbering: { invoices: 'CW', quotations: 'EST' },
    dueDays: 0,
    design: 'modern',
    terms: 'Please collect your vehicle within 24 hours of the promised time. Valuables left in the vehicle are the owner\'s responsibility.',
    dashboard: ['sales_today', 'board:c_job_cards', 'receivables', 'attendance_today', 'warranties_expiring', 'top_items'],
  },

  sample: {
    packages: [
      { name: 'Monsoon care package', category: 'Packages', packagePricing: 'fixed', priceMinor: rs(1999), components: [
        { name: 'Interior + exterior deep clean', quantity: 1 }, { name: 'Rubbing & polishing', quantity: 1 },
        { name: 'Microfibre cloth', quantity: 1 },
      ] },
      { name: 'Quick shine combo', category: 'Packages', packagePricing: 'percent', packageDiscountPct: 10, components: [
        { name: 'Foam wash (exterior)', quantity: 1 }, { name: 'Engine bay cleaning', quantity: 1 },
      ] },
    ],
    services: [
      { name: 'Foam wash (exterior)', category: 'Washing', unit: 'Wash', taxRate: 18, variants: perVehicle(299, 349, 449, 499, 149) },
      { name: 'Interior + exterior deep clean', category: 'Washing', unit: 'Wash', taxRate: 18, variants: perVehicle(699, 799, 999, 1099, 249) },
      { name: 'Rubbing & polishing', category: 'Detailing', unit: 'Service', taxRate: 18, variants: perVehicle(1499, 1799, 2199, 2399, 599) },
      { name: 'Ceramic coating (9H)', category: 'Coating', unit: 'Service', taxRate: 18, variants: perVehicle(14999, 17999, 21999, 23999, 5999), warranty: { duration: 2, unit: 'years', scope: 'service', includes: ['Gloss retention', 'Hydrophobic (water-beading) performance', 'Free annual top-up inspection'], excludes: ['Scratches, swirls and stone chips', 'Damage from automatic brush washes', 'Panels repainted after coating'] } },
      { name: 'Engine bay cleaning', category: 'Add-ons', unit: 'Service', taxRate: 18, variants: perVehicle(399, 399, 499, 499, 199) },
    ],
    products: [
      { name: 'Car shampoo 1L', category: 'Shampoo & chemicals', unit: 'Litre', hsn: '3405', taxRate: 18, priceMinor: rs(450), costMinor: rs(260), trackStock: true, stock: 24, lowStock: 6 },
      { name: 'Microfibre cloth', category: 'Microfibre', unit: 'Pcs', taxRate: 18, priceMinor: rs(149), costMinor: rs(70), trackStock: true, stock: 60, lowStock: 15 },
    ],
  },
};
