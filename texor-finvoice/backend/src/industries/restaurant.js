import { PAYMENT_MODES, options, rs } from './helpers.js';

const halfFull = (half, full) => [{ name: 'Half', priceMinor: rs(half) }, { name: 'Full', priceMinor: rs(full) }];

export default {
  key: 'restaurant',
  name: 'Restaurant & café',
  tagline: 'A menu with veg marks and portions, table-wise bills and 80mm receipts.',
  icon: 'utensils-crossed',
  accent: '#d9480f',
  highlights: ['Menu with veg / non-veg marks and half–full portions', 'Bills by table and order type', 'Thermal receipt layout out of the box'],

  modules: {
    dashboard: { order: 0 },
    invoices: { order: 10, label: 'Bills', labelSingular: 'Bill', icon: 'receipt' },
    c_tables: { order: 15 },
    products: { order: 20, label: 'Menu', labelSingular: 'Menu item', icon: 'utensils-crossed' },
    customers: { order: 30, label: 'Guests', labelSingular: 'Guest', icon: 'users' },
    payments: { order: 35 },
    quotations: { order: 40, label: 'Catering quotes', labelSingular: 'Catering quote' },
    services: { order: 90, enabled: false },
    warranties: { order: 91, enabled: false },
    staff: { order: 60 },
  },

  fieldOverrides: {
    products: { trackStock: { default: false }, sku: { hidden: true }, barcode: { hidden: true }, hsn: { label: 'HSN/SAC' } },
    invoices: { date: { label: 'Bill date' }, dueDate: { hidden: true } },
  },

  customModules: [
    {
      key: 'c_tables', label: 'Tables', labelSingular: 'Table', icon: 'armchair', group: 'operations',
      titleField: 'tableNo', boardField: 'status',
      fields: [
        { key: 'tableNo', label: 'Table', type: 'text', required: true, placeholder: 'T4' },
        { key: 'status', label: 'Status', type: 'select', required: true, default: 'available', options: options('Available', 'Occupied', 'Reserved', 'Cleaning') },
        { key: 'area', label: 'Area', type: 'select', options: options('Indoor', 'Outdoor', 'Rooftop', 'Private dining') },
        { key: 'seats', label: 'Seats', type: 'number' },
      ],
    },
  ],

  fields: {
    products: [
      { key: 'foodType', label: 'Food type', type: 'select', required: true, options: options('Veg', 'Non-veg', 'Egg', 'Vegan'), printable: true },
      { key: 'spice', label: 'Spice level', type: 'select', options: options('Mild', 'Medium', 'Hot') },
      { key: 'available', label: 'Available today', type: 'checkbox', default: true },
    ],
    invoices: [
      { key: 'orderType', label: 'Order type', type: 'select', options: options('Dine-in', 'Takeaway', 'Delivery'), default: 'dine_in', printable: true },
      { key: 'table', label: 'Table', type: 'reference', refModule: 'c_tables', printable: true },
      { key: 'covers', label: 'Covers', type: 'number', printable: true },
    ],
    customers: [{ key: 'birthday', label: 'Birthday', type: 'date' }, { key: 'anniversary', label: 'Anniversary', type: 'date' }],
  },

  preferences: {
    taxRate: 5,
    priceIncludesTax: false,
    units: ['Plate', 'Bowl', 'Glass', 'Piece'],
    paymentModes: [...PAYMENT_MODES.filter((m) => m !== 'Cheque'), 'Swiggy / Zomato'],
    categories: { products: ['Starters', 'Main course', 'Breads', 'Rice & biryani', 'Desserts', 'Beverages'] },
    designations: ['Chef', 'Captain', 'Steward', 'Cashier', 'Cleaner'],
    numbering: { invoices: 'BILL', quotations: 'CQ' },
    dueDays: 0,
    design: 'thermal',
    terms: 'Thank you for dining with us! GST on restaurant service @5% without input tax credit.',
    dashboard: ['sales_today', 'board:c_tables', 'top_items', 'payment_modes_today', 'attendance_today'],
    walkInCustomer: 'Walk-in guest',
  },

  sample: {
    products: [
      { name: 'Paneer tikka', category: 'Starters', unit: 'Plate', hsn: '996331', taxRate: 5, variants: halfFull(180, 320), custom: { foodType: 'veg', spice: 'medium' } },
      { name: 'Chicken 65', category: 'Starters', unit: 'Plate', hsn: '996331', taxRate: 5, variants: halfFull(200, 360), custom: { foodType: 'non_veg', spice: 'hot' } },
      { name: 'Dal makhani', category: 'Main course', unit: 'Bowl', hsn: '996331', taxRate: 5, priceMinor: rs(240), custom: { foodType: 'veg', spice: 'mild' } },
      { name: 'Chicken biryani', category: 'Rice & biryani', unit: 'Plate', hsn: '996331', taxRate: 5, variants: halfFull(220, 380), custom: { foodType: 'non_veg', spice: 'medium' } },
      { name: 'Butter naan', category: 'Breads', unit: 'Piece', hsn: '996331', taxRate: 5, priceMinor: rs(60), custom: { foodType: 'veg' } },
      { name: 'Gulab jamun (2 pcs)', category: 'Desserts', unit: 'Bowl', hsn: '996331', taxRate: 5, priceMinor: rs(90), custom: { foodType: 'veg' } },
      { name: 'Masala chai', category: 'Beverages', unit: 'Glass', hsn: '996331', taxRate: 5, priceMinor: rs(40), custom: { foodType: 'veg' } },
      { name: 'Fresh lime soda', category: 'Beverages', unit: 'Glass', hsn: '996331', taxRate: 5, priceMinor: rs(90), custom: { foodType: 'vegan' } },
    ],
    packages: [
      { name: 'Veg thali', category: 'Combos', packagePricing: 'fixed', priceMinor: rs(349), components: [
        { name: 'Dal makhani', quantity: 1 }, { name: 'Butter naan', quantity: 2 },
        { name: 'Gulab jamun (2 pcs)', quantity: 1 }, { name: 'Masala chai', quantity: 1 },
      ] },
      { name: 'Biryani combo', category: 'Combos', packagePricing: 'percent', packageDiscountPct: 10, components: [
        { name: 'Chicken biryani', variant: 'Full', quantity: 1 }, { name: 'Fresh lime soda', quantity: 1 },
      ] },
    ],
    records: {
      c_tables: [1, 2, 3, 4, 5, 6].map((n) => ({ tableNo: `T${n}`, status: 'available', area: n > 4 ? 'outdoor' : 'indoor', seats: n % 2 ? 4 : 2 })),
    },
  },
};
