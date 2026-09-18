import { PAYMENT_MODES, options, rs } from './helpers.js';

export default {
  key: 'salon',
  name: 'Salon & spa',
  tagline: 'Client profiles, appointments and a stylist on every line of the bill.',
  icon: 'scissors',
  accent: '#c2255c',
  highlights: ['Appointment board from booked to completed', 'Stylist recorded per service for commissions later', 'Client birthdays, preferences and allergies'],

  modules: {
    dashboard: { order: 0 },
    c_appointments: { order: 10 },
    customers: { order: 20, label: 'Clients', labelSingular: 'Client' },
    invoices: { order: 30 },
    payments: { order: 35 },
    services: { order: 40, icon: 'scissors' },
    products: { order: 45, label: 'Retail products', labelSingular: 'Retail product' },
    quotations: { order: 50, label: 'Package quotes', labelSingular: 'Package quote' },
    warranties: { order: 90, enabled: false },
    staff: { order: 60 },
  },

  customModules: [
    {
      key: 'c_appointments', label: 'Appointments', labelSingular: 'Appointment', icon: 'calendar-clock', group: 'operations',
      titleField: 'startsAt', boardField: 'status', customerLink: true,
      toInvoice: { items: ['services'] },
      fields: [
        { key: 'startsAt', label: 'Date & time', type: 'datetime', required: true },
        { key: 'status', label: 'Status', type: 'select', required: true, default: 'booked', options: options('Booked', 'Checked in', 'In service', 'Completed', 'No-show', 'Cancelled') },
        { key: 'stylist', label: 'Stylist', type: 'reference', refModule: 'staff' },
        { key: 'services', label: 'Services', type: 'items', refModule: 'services' },
        { key: 'notes', label: 'Notes', type: 'longtext' },
      ],
    },
  ],

  fields: {
    customers: [
      { key: 'gender', label: 'Gender', type: 'select', options: options('Female', 'Male', 'Other') },
      { key: 'birthday', label: 'Birthday', type: 'date' },
      { key: 'preferences', label: 'Preferences & allergies', type: 'longtext' },
    ],
    services: [{ key: 'for', label: 'For', type: 'select', options: options('Women', 'Men', 'Unisex') }],
    lines: [{ key: 'stylist', label: 'Stylist', type: 'reference', refModule: 'staff', printable: true }],
  },

  preferences: {
    taxRate: 5,
    priceIncludesTax: true,
    units: ['Service', 'Session', 'Pcs'],
    paymentModes: PAYMENT_MODES,
    categories: { services: ['Hair', 'Skin', 'Nails', 'Spa', 'Makeup', 'Grooming'], products: ['Hair care', 'Skin care', 'Tools'] },
    designations: ['Stylist', 'Beautician', 'Therapist', 'Receptionist'],
    numbering: { invoices: 'SAL', quotations: 'PKG' },
    dueDays: 0,
    design: 'modern',
    terms: 'Salon services attract GST @5% without input tax credit. Thank you for visiting!',
    dashboard: ['sales_today', 'board:c_appointments', 'top_items', 'attendance_today', 'receivables'],
  },

  sample: {
    packages: [
      { name: 'Bridal package', category: 'Packages', packagePricing: 'fixed', priceMinor: rs(5999), components: [
        { name: 'Haircut & styling', quantity: 1 }, { name: 'Global hair colour', quantity: 1 },
        { name: 'Hydrating facial', quantity: 1 }, { name: 'Gel manicure', quantity: 1 },
      ] },
      { name: 'Groom package', category: 'Packages', packagePricing: 'percent', packageDiscountPct: 15, components: [
        { name: 'Haircut & styling', quantity: 1 }, { name: 'Beard trim & shape', quantity: 1 },
        { name: 'Hydrating facial', quantity: 1 },
      ] },
    ],
    services: [
      { name: 'Haircut & styling', category: 'Hair', unit: 'Service', duration: 45, taxRate: 5, priceMinor: rs(599), custom: { for: 'unisex' } },
      { name: 'Global hair colour', category: 'Hair', unit: 'Service', duration: 120, taxRate: 5, priceMinor: rs(3499), custom: { for: 'women' } },
      { name: 'Hydrating facial', category: 'Skin', unit: 'Session', duration: 60, taxRate: 5, priceMinor: rs(1999), custom: { for: 'unisex' } },
      { name: 'Gel manicure', category: 'Nails', unit: 'Service', duration: 45, taxRate: 5, priceMinor: rs(899), custom: { for: 'women' } },
      { name: 'Beard trim & shape', category: 'Grooming', unit: 'Service', duration: 20, taxRate: 5, priceMinor: rs(249), custom: { for: 'men' } },
      { name: 'Swedish massage (60 min)', category: 'Spa', unit: 'Session', duration: 60, taxRate: 5, priceMinor: rs(2499), custom: { for: 'unisex' } },
    ],
  },
};
