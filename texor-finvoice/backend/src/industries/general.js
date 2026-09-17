import { PAYMENT_MODES } from './helpers.js';

export default {
  key: 'general',
  name: 'General business',
  tagline: 'Every Lite module with neutral defaults — shape it however you work.',
  icon: 'briefcase-business',
  accent: '#12a57f',
  highlights: ['Quotations, invoices and payments', 'Products, services and warranties', 'Rename anything, add any field'],

  modules: {},
  customModules: [],
  fields: {},

  preferences: {
    taxRate: 18,
    priceIncludesTax: false,
    units: ['Pcs', 'Service', 'Hour', 'Kg', 'Box'],
    paymentModes: PAYMENT_MODES,
    categories: {},
    designations: ['Manager', 'Executive', 'Associate'],
    numbering: { invoices: 'INV', quotations: 'QT' },
    dueDays: 15,
    design: 'classic',
    terms: '',
    dashboard: ['sales_month', 'receivables', 'overdue', 'quotes_open', 'low_stock', 'warranties_expiring'],
  },

  sample: {},
};
