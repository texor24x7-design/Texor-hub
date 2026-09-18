import { PAYMENT_MODES, options, rs } from './helpers.js';

export default {
  key: 'garage',
  name: 'Auto service & garage',
  tagline: 'Vehicle history, estimates and job cards with parts and labour.',
  icon: 'wrench',
  accent: '#e67700',
  highlights: ['Job cards with parts and labour on separate lists', 'Estimates approved before work starts', 'Parts warranties issued automatically'],

  modules: {
    dashboard: { order: 0 },
    c_job_cards: { order: 10 },
    customers: { order: 20 },
    c_vehicles: { order: 25 },
    quotations: { order: 30, label: 'Estimates', labelSingular: 'Estimate' },
    invoices: { order: 35 },
    payments: { order: 40 },
    products: { order: 50, label: 'Spare parts', labelSingular: 'Spare part', icon: 'cog' },
    services: { order: 55, label: 'Labour & services', labelSingular: 'Labour item', icon: 'wrench' },
    warranties: { order: 60, label: 'Parts warranties', labelSingular: 'Parts warranty' },
    staff: { order: 70 },
  },

  customModules: [
    {
      key: 'c_vehicles', label: 'Vehicles', labelSingular: 'Vehicle', icon: 'car-front', group: 'sales',
      titleField: 'regNo', customerLink: true,
      fields: [
        { key: 'regNo', label: 'Registration no.', type: 'text', required: true },
        { key: 'make', label: 'Make', type: 'text' },
        { key: 'model', label: 'Model', type: 'text' },
        { key: 'fuel', label: 'Fuel', type: 'select', options: options('Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid') },
        { key: 'year', label: 'Year', type: 'number' },
        { key: 'vin', label: 'Chassis / VIN', type: 'text' },
        { key: 'insuranceExpiry', label: 'Insurance expires', type: 'date' },
      ],
    },
    {
      key: 'c_job_cards', label: 'Job cards', labelSingular: 'Job card', icon: 'clipboard-list', group: 'operations',
      titleField: 'vehicle', boardField: 'stage', customerLink: true,
      toInvoice: { items: ['parts', 'labour'], fields: { vehicleNo: 'vehicle.regNo', odometer: 'odometer' } },
      fields: [
        { key: 'vehicle', label: 'Vehicle', type: 'reference', refModule: 'c_vehicles', required: true },
        { key: 'stage', label: 'Stage', type: 'select', required: true, default: 'received', options: options('Received', 'Inspection', 'Estimate sent', 'Approved', 'In repair', 'Ready', 'Delivered') },
        { key: 'complaints', label: 'Customer complaints', type: 'longtext' },
        { key: 'odometer', label: 'Odometer (km)', type: 'number' },
        { key: 'mechanic', label: 'Mechanic', type: 'reference', refModule: 'staff' },
        { key: 'promisedAt', label: 'Promised by', type: 'datetime' },
        { key: 'parts', label: 'Parts', type: 'items', refModule: 'products', section: 'Work' },
        { key: 'labour', label: 'Labour', type: 'items', refModule: 'services', section: 'Work' },
      ],
    },
  ],

  fields: {
    invoices: [
      { key: 'vehicleNo', label: 'Vehicle no.', type: 'text', printable: true },
      { key: 'odometer', label: 'Odometer (km)', type: 'number', printable: true },
    ],
    quotations: [{ key: 'vehicleNo', label: 'Vehicle no.', type: 'text', printable: true }],
    products: [
      { key: 'partNo', label: 'Part no.', type: 'text', printable: true },
      { key: 'fits', label: 'Fits', type: 'text' },
    ],
  },

  preferences: {
    taxRate: 18,
    priceIncludesTax: false,
    units: ['Pcs', 'Set', 'Litre', 'Hour', 'Job'],
    paymentModes: [...PAYMENT_MODES, 'Insurance claim'],
    categories: { products: ['Engine', 'Brakes', 'Suspension', 'Electrical', 'Oils & fluids', 'Filters', 'Body'], services: ['General service', 'Repair', 'Denting & painting', 'Diagnostics'] },
    designations: ['Mechanic', 'Electrician', 'Painter', 'Service advisor', 'Cashier'],
    numbering: { invoices: 'GS', quotations: 'EST' },
    dueDays: 7,
    design: 'classic',
    terms: 'Replaced parts are returned to the owner on request. Vehicles not collected within 3 days of completion attract parking charges.',
    dashboard: ['board:c_job_cards', 'sales_month', 'receivables', 'low_stock', 'warranties_expiring', 'attendance_today'],
  },

  sample: {
    products: [
      { name: 'Engine oil 5W-30 (1L)', category: 'Oils & fluids', unit: 'Litre', hsn: '2710', taxRate: 18, priceMinor: rs(780), costMinor: rs(540), trackStock: true, stock: 40, lowStock: 10 },
      { name: 'Oil filter', category: 'Filters', unit: 'Pcs', hsn: '8421', taxRate: 18, priceMinor: rs(350), costMinor: rs(210), trackStock: true, stock: 25, lowStock: 6 },
      { name: 'Front brake pads (set)', category: 'Brakes', unit: 'Set', hsn: '8708', taxRate: 18, priceMinor: rs(1850), costMinor: rs(1250), trackStock: true, stock: 12, lowStock: 4, warranty: { duration: 6, unit: 'months', scope: 'parts', includes: ['Manufacturing defects in the pad material', 'Uneven wear from a defective pad'], excludes: ['Normal wear from use', 'Damage from driving with worn discs'] } },
      { name: 'Car battery 12V 35Ah', category: 'Electrical', unit: 'Pcs', hsn: '8507', taxRate: 18, priceMinor: rs(5600), costMinor: rs(4500), trackStock: true, trackSerials: true, stock: 6, lowStock: 2, warranty: { duration: 36, unit: 'months', scope: 'replacement', includes: ['Free replacement in the first 18 months', 'Pro-rata credit for the remaining period'], excludes: ['Damage from a faulty alternator', 'Physical damage or leakage from misuse'], coverage: 'Bring the battery and this certificate to claim.' } },
    ],
    services: [
      { name: 'Periodic service labour', category: 'General service', unit: 'Job', taxRate: 18, priceMinor: rs(1200) },
      { name: 'Brake pad replacement labour', category: 'Repair', unit: 'Job', taxRate: 18, priceMinor: rs(450) },
      { name: 'Computer diagnostics', category: 'Diagnostics', unit: 'Job', taxRate: 18, priceMinor: rs(699) },
      { name: 'Wheel alignment & balancing', category: 'General service', unit: 'Job', taxRate: 18, priceMinor: rs(899) },
    ],
  },
};
