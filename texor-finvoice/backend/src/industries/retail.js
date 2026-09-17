import { PAYMENT_MODES, options, rs } from './helpers.js';

export default {
  key: 'retail',
  name: 'Retail store',
  tagline: 'Barcode-first products, MRP-inclusive pricing and stock alerts.',
  icon: 'store',
  accent: '#1098ad',
  highlights: ['Scan a barcode to add an item', 'MRP printed beside your price', 'Low-stock alerts before shelves go empty'],

  modules: {
    dashboard: { order: 0 },
    invoices: { order: 10 },
    products: { order: 20 },
    customers: { order: 30 },
    payments: { order: 35 },
    quotations: { order: 40 },
    services: { order: 90, enabled: false },
    warranties: { order: 50 },
    staff: { order: 60 },
  },

  fieldOverrides: {
    products: { barcode: { order: 1 }, trackStock: { default: true } },
  },

  fields: {
    products: [
      { key: 'brand', label: 'Brand', type: 'text' },
      { key: 'mrp', label: 'MRP', type: 'currency', printable: true },
      { key: 'expiry', label: 'Best before', type: 'date' },
    ],
    customers: [{ key: 'loyaltyNo', label: 'Loyalty card no.', type: 'text' }],
  },

  preferences: {
    taxRate: 5,
    priceIncludesTax: true,
    units: ['Pcs', 'Kg', 'g', 'L', 'ml', 'Pack', 'Box', 'Dozen'],
    paymentModes: PAYMENT_MODES,
    categories: { products: ['Grocery', 'Snacks & beverages', 'Personal care', 'Household', 'Stationery'] },
    designations: ['Cashier', 'Store assistant', 'Store manager', 'Delivery'],
    numbering: { invoices: 'RT', quotations: 'QT' },
    dueDays: 0,
    design: 'compact',
    terms: 'Goods once sold can be exchanged within 7 days with this bill. No refunds on discounted items.',
    dashboard: ['sales_today', 'payment_modes_today', 'low_stock', 'top_items', 'attendance_today'],
    walkInCustomer: 'Walk-in customer',
  },

  sample: {
    products: [
      { name: 'Basmati rice 5 kg', category: 'Grocery', unit: 'Pack', barcode: '8901234500011', taxRate: 5, priceMinor: rs(649), costMinor: rs(540), trackStock: true, stock: 30, lowStock: 8, custom: { mrp: rs(699) } },
      { name: 'Sunflower oil 1 L', category: 'Grocery', unit: 'L', barcode: '8901234500028', taxRate: 5, priceMinor: rs(155), costMinor: rs(128), trackStock: true, stock: 48, lowStock: 12, custom: { mrp: rs(170) } },
      { name: 'Toothpaste 150 g', category: 'Personal care', unit: 'Pcs', barcode: '8901234500035', taxRate: 5, priceMinor: rs(110), costMinor: rs(84), trackStock: true, stock: 36, lowStock: 10, custom: { mrp: rs(120) } },
      { name: 'Detergent powder 1 kg', category: 'Household', unit: 'Pack', barcode: '8901234500042', taxRate: 5, priceMinor: rs(135), costMinor: rs(108), trackStock: true, stock: 20, lowStock: 6, custom: { mrp: rs(145) } },
      { name: 'Notebook A4 (200 pages)', category: 'Stationery', unit: 'Pcs', barcode: '8901234500059', taxRate: 5, priceMinor: rs(85), costMinor: rs(58), trackStock: true, stock: 50, lowStock: 10, custom: { mrp: rs(95) } },
    ],
  },
};
