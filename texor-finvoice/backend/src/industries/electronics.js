import { PAYMENT_MODES, options, rs } from './helpers.js';

export default {
  key: 'electronics',
  name: 'Electronics & appliances',
  tagline: 'Serial-numbered stock, warranties per unit and a service desk for repairs.',
  icon: 'tv',
  accent: '#2563eb',
  highlights: ['Serial number captured on every unit sold', 'Warranty registered per serial, straight from the invoice', 'Repair tickets checked against warranty status'],

  modules: {
    dashboard: { order: 0 },
    invoices: { order: 10 },
    quotations: { order: 15 },
    customers: { order: 20 },
    payments: { order: 25 },
    products: { order: 30 },
    services: { order: 35, label: 'Installation & service', labelSingular: 'Service', icon: 'wrench' },
    warranties: { order: 40 },
    c_service_requests: { order: 45 },
    staff: { order: 60 },
  },

  fieldOverrides: {
    products: { trackStock: { default: true }, trackSerials: { default: true } },
  },

  customModules: [
    {
      key: 'c_service_requests', label: 'Service requests', labelSingular: 'Service request', icon: 'wrench', group: 'aftersales',
      titleField: 'issue', boardField: 'status', customerLink: true,
      toInvoice: { items: ['charges'] },
      fields: [
        { key: 'issue', label: 'Problem', type: 'text', required: true },
        { key: 'status', label: 'Status', type: 'select', required: true, default: 'received', options: options('Received', 'Diagnosing', 'Waiting for parts', 'Repaired', 'Delivered') },
        { key: 'product', label: 'Product', type: 'reference', refModule: 'products' },
        { key: 'serial', label: 'Serial number', type: 'text' },
        { key: 'warranty', label: 'Warranty', type: 'reference', refModule: 'warranties' },
        { key: 'technician', label: 'Technician', type: 'reference', refModule: 'staff' },
        { key: 'details', label: 'Diagnosis', type: 'longtext' },
        { key: 'charges', label: 'Parts & labour', type: 'items', refModule: 'items' },
      ],
    },
  ],

  fields: {
    products: [
      { key: 'brand', label: 'Brand', type: 'select', allowNew: true, options: options('Samsung', 'LG', 'Sony', 'Whirlpool', 'Voltas', 'Daikin', 'Apple', 'Xiaomi', 'OnePlus', 'Bosch'), printable: true },
      { key: 'model', label: 'Model no.', type: 'text', printable: true },
      { key: 'energyRating', label: 'Energy rating', type: 'select', options: options('1 star', '2 star', '3 star', '4 star', '5 star') },
    ],
  },

  preferences: {
    taxRate: 18,
    priceIncludesTax: true,
    units: ['Pcs', 'Set', 'Service'],
    paymentModes: [...PAYMENT_MODES, 'EMI / finance'],
    categories: { products: ['Televisions', 'Refrigerators', 'Washing machines', 'Air conditioners', 'Mobiles', 'Laptops', 'Kitchen appliances', 'Accessories'], services: ['Installation', 'Repair', 'Extended warranty'] },
    designations: ['Sales executive', 'Technician', 'Store manager', 'Cashier'],
    numbering: { invoices: 'INV', quotations: 'QT' },
    dueDays: 0,
    design: 'classic',
    terms: 'Goods once sold will not be taken back. Warranty is provided by the manufacturer as per the warranty card; keep this invoice for warranty claims.',
    dashboard: ['sales_today', 'sales_month', 'low_stock', 'warranties_expiring', 'board:c_service_requests', 'receivables'],
  },

  sample: {
    products: [
      { name: '43" 4K Smart LED TV', category: 'Televisions', unit: 'Pcs', hsn: '8528', taxRate: 18, priceMinor: rs(32990), costMinor: rs(27400), trackStock: true, trackSerials: true, stock: 6, lowStock: 2, warranty: { duration: 1, unit: 'years', coverage: 'Manufacturing defects in the panel and parts. Physical damage is not covered.' }, custom: { brand: 'samsung', model: 'UA43CUE60' } },
      { name: '1.5 ton 5 star inverter split AC', category: 'Air conditioners', unit: 'Pcs', hsn: '8415', taxRate: 18, priceMinor: rs(44990), costMinor: rs(38100), trackStock: true, trackSerials: true, stock: 4, lowStock: 2, warranty: { duration: 1, unit: 'years', coverage: 'Comprehensive product warranty. Compressor warranty per manufacturer terms.' }, custom: { brand: 'daikin', energyRating: '5_star' } },
      { name: '253L double-door refrigerator', category: 'Refrigerators', unit: 'Pcs', hsn: '8418', taxRate: 18, priceMinor: rs(26490), costMinor: rs(22300), trackStock: true, trackSerials: true, stock: 5, lowStock: 2, warranty: { duration: 1, unit: 'years', coverage: 'Manufacturing defects.' }, custom: { brand: 'whirlpool', energyRating: '3_star' } },
      { name: '7 kg front-load washing machine', category: 'Washing machines', unit: 'Pcs', hsn: '8450', taxRate: 18, priceMinor: rs(29990), costMinor: rs(25200), trackStock: true, trackSerials: true, stock: 3, lowStock: 1, warranty: { duration: 2, unit: 'years', coverage: 'Comprehensive warranty on the product.' }, custom: { brand: 'lg' } },
      { name: 'Smartphone 8GB/256GB', category: 'Mobiles', unit: 'Pcs', hsn: '8517', taxRate: 18, priceMinor: rs(24999), costMinor: rs(21800), trackStock: true, trackSerials: true, stock: 10, lowStock: 3, warranty: { duration: 1, unit: 'years', coverage: 'Handset manufacturing defects; accessories 6 months.' }, custom: { brand: 'oneplus' } },
    ],
    services: [
      { name: 'AC installation', category: 'Installation', unit: 'Service', taxRate: 18, priceMinor: rs(1499) },
      { name: 'Wall-mount TV installation', category: 'Installation', unit: 'Service', taxRate: 18, priceMinor: rs(599) },
      { name: 'Extended warranty (+2 years)', category: 'Extended warranty', unit: 'Service', taxRate: 18, priceMinor: rs(2999), warranty: { duration: 2, unit: 'years', coverage: 'Extends manufacturer warranty on parts and labour.' } },
    ],
  },
};
