/**
 * Every module Finvoice knows how to run, and the fields each one is built on.
 *
 * A workspace never edits this file's contents — it stores its own copy of the
 * parts people may change (names, icons, order, extra fields) and this stays the
 * source of what a module *is*: which actions exist, which fields the code
 * depends on and so must never be deleted.
 */

export const EDITIONS = ['lite', 'pro'];

export const FIELD_TYPES = [
  'text', 'longtext', 'number', 'currency', 'percent', 'date', 'time', 'datetime',
  'select', 'multiselect', 'checkbox', 'email', 'phone', 'url', 'image', 'file',
  'reference', 'gstin', 'state', 'address', 'items', 'variants', 'warranty',
];

/** Types a person can add as a custom field. The rest exist for system fields. */
export const CUSTOM_FIELD_TYPES = [
  'text', 'longtext', 'number', 'currency', 'percent', 'date', 'time', 'datetime',
  'select', 'multiselect', 'checkbox', 'email', 'phone', 'url', 'image', 'file', 'reference', 'items',
];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve'];
const CRUD = ['view', 'create', 'edit', 'delete', 'export'];

const field = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

const warrantyField = field('warranty', 'Warranty', 'warranty', {
  section: 'Warranty',
  help: 'Invoices issue a warranty automatically for items that carry one.',
});

/**
 * `approve` means the module's irreversible step: issuing an invoice, sending a
 * quotation, marking someone else's attendance.
 */
export const CORE_MODULES = [
  { key: 'dashboard', label: 'Dashboard', labelSingular: 'Dashboard', icon: 'layout-dashboard', edition: 'lite', group: 'main', actions: ['view'], fields: [] },

  {
    key: 'customers', label: 'Customers', labelSingular: 'Customer', icon: 'users', edition: 'lite', group: 'sales', actions: CRUD,
    titleField: 'name',
    fields: [
      field('name', 'Name', 'text', { required: true, locked: true }),
      field('kind', 'Type', 'select', { options: [{ value: 'individual', label: 'Individual' }, { value: 'business', label: 'Business' }], default: 'individual' }),
      field('phone', 'Phone', 'phone'),
      field('email', 'Email', 'email'),
      field('gstin', 'GSTIN', 'gstin', { section: 'Tax', help: 'Filling this in sets the place of supply.' }),
      field('stateCode', 'Place of supply', 'state', { section: 'Tax' }),
      field('billingAddress', 'Billing address', 'address', { section: 'Addresses' }),
      field('shippingAddress', 'Shipping address', 'address', { section: 'Addresses' }),
      field('tags', 'Tags', 'multiselect', { allowNew: true, options: [] }),
      field('notes', 'Notes', 'longtext'),
    ],
  },

  {
    key: 'quotations', label: 'Quotations', labelSingular: 'Quotation', icon: 'file-pen-line', edition: 'lite', group: 'sales', actions: [...CRUD, 'approve'],
    document: true,
    fields: [
      field('customer', 'Customer', 'reference', { refModule: 'customers', required: true, locked: true }),
      field('date', 'Quotation date', 'date', { required: true, locked: true }),
      field('validUntil', 'Valid until', 'date'),
      field('placeOfSupply', 'Place of supply', 'state', { locked: true }),
      field('reference', 'Reference', 'text'),
      field('notes', 'Notes', 'longtext', { printable: true }),
      field('terms', 'Terms & conditions', 'longtext', { printable: true }),
    ],
  },

  {
    key: 'invoices', label: 'Invoices', labelSingular: 'Invoice', icon: 'receipt-indian-rupee', edition: 'lite', group: 'sales', actions: [...CRUD, 'approve'],
    document: true,
    fields: [
      field('customer', 'Customer', 'reference', { refModule: 'customers', required: true, locked: true }),
      field('date', 'Invoice date', 'date', { required: true, locked: true }),
      field('dueDate', 'Due date', 'date'),
      field('placeOfSupply', 'Place of supply', 'state', { locked: true }),
      field('reference', 'PO / reference', 'text'),
      field('notes', 'Notes', 'longtext', { printable: true }),
      field('terms', 'Terms & conditions', 'longtext', { printable: true }),
    ],
  },

  /** Line items are not a page, but their columns can be renamed and extended. */
  {
    key: 'lines', label: 'Line items', labelSingular: 'Line item', icon: 'list', edition: 'lite', group: 'hidden', actions: [], page: false,
    fields: [
      field('item', 'Item', 'reference', { refModule: 'items', locked: true }),
      field('description', 'Description', 'text', { required: true, locked: true }),
      field('hsn', 'HSN/SAC', 'text', { locked: true }),
      field('quantity', 'Qty', 'number', { required: true, locked: true }),
      field('unit', 'Unit', 'text', { locked: true }),
      field('priceMinor', 'Rate', 'currency', { required: true, locked: true }),
      field('discountPct', 'Discount %', 'percent', { locked: true }),
      field('taxRate', 'GST %', 'percent', { locked: true }),
    ],
  },

  {
    key: 'payments', label: 'Payments', labelSingular: 'Payment', icon: 'wallet', edition: 'lite', group: 'sales', actions: ['view', 'create', 'delete', 'export'],
    fields: [
      field('date', 'Date', 'date', { required: true, locked: true }),
      field('amountMinor', 'Amount', 'currency', { required: true, locked: true }),
      field('mode', 'Mode', 'select', { locked: true, allowNew: true, options: [] }),
      field('reference', 'Reference / UTR', 'text'),
      field('note', 'Note', 'longtext'),
    ],
  },

  {
    key: 'products', label: 'Products', labelSingular: 'Product', icon: 'package', edition: 'lite', group: 'catalogue', actions: CRUD,
    titleField: 'name', itemKind: 'product',
    fields: [
      field('name', 'Name', 'text', { required: true, locked: true }),
      field('category', 'Category', 'select', { allowNew: true, options: [] }),
      field('sku', 'SKU', 'text'),
      field('barcode', 'Barcode', 'text'),
      field('description', 'Description', 'longtext'),
      field('image', 'Image', 'image'),
      field('unit', 'Unit', 'select', { allowNew: true, options: [], section: 'Pricing' }),
      field('priceMinor', 'Selling price', 'currency', { required: true, locked: true, section: 'Pricing' }),
      field('costMinor', 'Purchase price', 'currency', { section: 'Pricing', help: 'Hidden from roles that should not see margins.' }),
      field('taxRate', 'GST %', 'percent', { section: 'Pricing' }),
      field('cessRate', 'Cess %', 'percent', { section: 'Pricing' }),
      field('priceIncludesTax', 'Price includes GST', 'checkbox', { section: 'Pricing' }),
      field('hsn', 'HSN code', 'text', { section: 'Pricing' }),
      field('variants', 'Variants', 'variants', { section: 'Pricing' }),
      field('trackStock', 'Track stock', 'checkbox', { section: 'Inventory', default: true }),
      field('stock', 'In stock', 'number', { section: 'Inventory', readOnly: true }),
      field('lowStock', 'Low stock alert at', 'number', { section: 'Inventory' }),
      field('trackSerials', 'Track serial numbers', 'checkbox', { section: 'Inventory' }),
      warrantyField,
    ],
  },

  {
    key: 'services', label: 'Services', labelSingular: 'Service', icon: 'sparkles', edition: 'lite', group: 'catalogue', actions: CRUD,
    titleField: 'name', itemKind: 'service',
    fields: [
      field('name', 'Name', 'text', { required: true, locked: true }),
      field('category', 'Category', 'select', { allowNew: true, options: [] }),
      field('sku', 'Code', 'text'),
      field('description', 'Description', 'longtext'),
      field('image', 'Image', 'image'),
      field('duration', 'Duration (minutes)', 'number'),
      field('unit', 'Unit', 'select', { allowNew: true, options: [], section: 'Pricing' }),
      field('priceMinor', 'Price', 'currency', { required: true, locked: true, section: 'Pricing' }),
      field('costMinor', 'Cost', 'currency', { section: 'Pricing' }),
      field('taxRate', 'GST %', 'percent', { section: 'Pricing' }),
      field('priceIncludesTax', 'Price includes GST', 'checkbox', { section: 'Pricing' }),
      field('hsn', 'SAC code', 'text', { section: 'Pricing' }),
      field('variants', 'Variants', 'variants', { section: 'Pricing' }),
      warrantyField,
    ],
  },

  {
    key: 'warranties', label: 'Warranties', labelSingular: 'Warranty', icon: 'shield-check', edition: 'lite', group: 'aftersales', actions: [...CRUD, 'approve'],
    titleField: 'itemName',
    fields: [
      field('customer', 'Customer', 'reference', { refModule: 'customers', required: true, locked: true }),
      field('item', 'Product / service', 'reference', { refModule: 'items', locked: true }),
      field('itemName', 'Covered item', 'text', { required: true, locked: true }),
      field('serial', 'Serial number', 'text', { locked: true }),
      field('startDate', 'Starts', 'date', { required: true, locked: true }),
      field('endDate', 'Ends', 'date', { required: true, locked: true }),
      field('coverage', 'What is covered', 'longtext'),
    ],
  },

  {
    key: 'staff', label: 'Staff & attendance', labelSingular: 'Staff member', icon: 'calendar-check', edition: 'lite', group: 'people', actions: [...CRUD, 'approve'],
    titleField: 'name',
    fields: [
      field('name', 'Name', 'text', { required: true, locked: true }),
      field('photo', 'Photo', 'image'),
      field('designation', 'Role', 'select', { allowNew: true, options: [] }),
      field('phone', 'Phone', 'phone'),
      field('email', 'Email', 'email', { help: 'If this person has a Texor account, they can check themselves in.' }),
      field('joinedOn', 'Joined on', 'date'),
      field('shiftStart', 'Shift starts', 'time', { section: 'Shift' }),
      field('shiftEnd', 'Shift ends', 'time', { section: 'Shift' }),
      field('active', 'Active', 'checkbox', { default: true }),
    ],
  },

  { key: 'team', label: 'Team & roles', labelSingular: 'Team', icon: 'user-cog', edition: 'lite', group: 'admin', actions: ['view', 'edit'], fields: [] },
  { key: 'settings', label: 'Settings', labelSingular: 'Settings', icon: 'settings', edition: 'lite', group: 'admin', actions: ['view', 'edit'], fields: [] },

  // Finvoice Pro — registered so the sidebar can show what upgrading unlocks.
  { key: 'reports', label: 'Reports', labelSingular: 'Report', icon: 'chart-no-axes-combined', edition: 'pro', group: 'insights', actions: ['view', 'export'], fields: [], teaser: 'Profit & loss, sales by payment mode, stock valuation and GST summaries.' },
  { key: 'gst', label: 'GST filing', labelSingular: 'GST return', icon: 'landmark', edition: 'pro', group: 'insights', actions: ['view', 'export', 'approve'], fields: [], teaser: 'GSTR-1 and GSTR-3B prepared from your invoices, plus e-invoice IRN and e-way bills.' },
  { key: 'crm', label: 'CRM pipeline', labelSingular: 'Lead', icon: 'kanban', edition: 'pro', group: 'growth', actions: CRUD, fields: [], teaser: 'Leads, deals and follow-ups that turn into quotations.' },
  { key: 'calendar', label: 'Calendar', labelSingular: 'Event', icon: 'calendar-days', edition: 'pro', group: 'growth', actions: CRUD, fields: [], teaser: 'Appointments and bookings tied to customers and staff.' },
  { key: 'marketing', label: 'Marketing', labelSingular: 'Campaign', icon: 'megaphone', edition: 'pro', group: 'growth', actions: CRUD, fields: [], teaser: 'WhatsApp, email and social campaigns to your customer segments.' },
  { key: 'integrations', label: 'Integrations', labelSingular: 'Integration', icon: 'plug', edition: 'pro', group: 'growth', actions: ['view', 'edit'], fields: [], teaser: 'Payment gateways, accounting exports and marketplace connections.' },
  { key: 'pos', label: 'Point of sale', labelSingular: 'Sale', icon: 'monitor-smartphone', edition: 'pro', group: 'growth', actions: CRUD, fields: [], teaser: 'Fast counter billing, KOTs, tables and thermal printers.' },
];

export const MODULE_GROUPS = [
  { key: 'main', label: '' },
  { key: 'sales', label: 'Sales' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'operations', label: 'Operations' },
  { key: 'aftersales', label: 'After sales' },
  { key: 'people', label: 'People' },
  { key: 'insights', label: 'Insights' },
  { key: 'growth', label: 'Growth' },
  { key: 'admin', label: 'Workspace' },
];

const byKey = new Map(CORE_MODULES.map((module) => [module.key, module]));
export const coreModule = (key) => byKey.get(key) ?? null;

export const CUSTOM_ACTIONS = CRUD;
export const isCustomModuleKey = (key) => typeof key === 'string' && key.startsWith('c_');

/**
 * Default roles. `'*'` grants every action on every module, present and future.
 * Custom modules not named in a role fall back to its `custom` entry.
 */
const all = (scope = 'all') => ({ actions: ACTIONS, scope });
const only = (actions, scope = 'all') => ({ actions, scope });

export const SYSTEM_ROLES = [
  {
    key: 'owner', name: 'Owner', description: 'Everything, including billing and deleting the workspace.',
    permissions: { '*': all() }, hiddenFields: {},
  },
  {
    key: 'admin', name: 'Admin', description: 'Everything except ownership and the edition.',
    permissions: { '*': all() }, hiddenFields: {},
  },
  {
    key: 'accountant', name: 'Accountant', description: 'Money in and out; read-only on operations.',
    permissions: {
      dashboard: only(['view']), customers: only(CRUD), quotations: all(), invoices: all(), payments: all(),
      products: only(['view', 'export']), services: only(['view', 'export']), warranties: only(['view', 'export']),
      staff: only(['view', 'export']), settings: only(['view']), reports: all(), gst: all(),
      custom: only(['view', 'export']),
    },
    hiddenFields: {},
  },
  {
    key: 'sales', name: 'Sales', description: 'Quotes and bills their own customers; no margins.',
    permissions: {
      dashboard: only(['view']), customers: only(['view', 'create', 'edit']),
      quotations: only(['view', 'create', 'edit', 'approve'], 'own'), invoices: only(['view', 'create', 'edit', 'approve'], 'own'),
      payments: only(['view', 'create']), products: only(['view']), services: only(['view']),
      warranties: only(['view', 'create', 'edit']), staff: only(['view']), crm: all('own'), calendar: all('own'),
      custom: only(['view', 'create', 'edit']),
    },
    hiddenFields: { products: ['costMinor'], services: ['costMinor'] },
  },
  {
    key: 'staff', name: 'Staff', description: 'Day-to-day work: job cards, customers, their own attendance.',
    permissions: {
      dashboard: only(['view']), customers: only(['view', 'create']), products: only(['view']), services: only(['view']),
      warranties: only(['view']), staff: only(['view']), invoices: only(['view', 'create'], 'own'),
      custom: only(['view', 'create', 'edit']),
    },
    hiddenFields: { products: ['costMinor'], services: ['costMinor'] },
  },
];
