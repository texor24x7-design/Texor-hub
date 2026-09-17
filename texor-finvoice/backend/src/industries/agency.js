import { options, rs } from './helpers.js';

export default {
  key: 'agency',
  name: 'Agency & freelancer',
  tagline: 'Proposals that become invoices, projects and retainers.',
  icon: 'pen-tool',
  accent: '#6741d9',
  highlights: ['Proposal → invoice in one click', 'Invoices tied to projects', 'Due dates and payment follow-ups'],

  modules: {
    dashboard: { order: 0 },
    c_projects: { order: 10 },
    customers: { order: 20, label: 'Clients', labelSingular: 'Client' },
    quotations: { order: 30, label: 'Proposals', labelSingular: 'Proposal' },
    invoices: { order: 35 },
    payments: { order: 40 },
    services: { order: 50 },
    products: { order: 90, enabled: false },
    warranties: { order: 91, enabled: false },
    staff: { order: 60, label: 'Team attendance', labelSingular: 'Team member' },
  },

  customModules: [
    {
      key: 'c_projects', label: 'Projects', labelSingular: 'Project', icon: 'folder-kanban', group: 'operations',
      titleField: 'name', boardField: 'status', customerLink: true,
      toInvoice: { items: ['deliverables'], fields: { project: '_id' } },
      fields: [
        { key: 'name', label: 'Project', type: 'text', required: true },
        { key: 'status', label: 'Status', type: 'select', required: true, default: 'planning', options: options('Planning', 'In progress', 'Review', 'Completed', 'On hold') },
        { key: 'startDate', label: 'Start', type: 'date' },
        { key: 'dueDate', label: 'Due', type: 'date' },
        { key: 'budget', label: 'Budget', type: 'currency' },
        { key: 'deliverables', label: 'Deliverables', type: 'items', refModule: 'services' },
        { key: 'brief', label: 'Brief', type: 'longtext' },
      ],
    },
  ],

  fields: {
    customers: [{ key: 'contactPerson', label: 'Contact person', type: 'text' }, { key: 'website', label: 'Website', type: 'url' }],
    invoices: [{ key: 'project', label: 'Project', type: 'reference', refModule: 'c_projects', printable: true }],
    quotations: [{ key: 'project', label: 'Project', type: 'reference', refModule: 'c_projects', printable: true }],
  },

  preferences: {
    taxRate: 18,
    priceIncludesTax: false,
    units: ['Project', 'Month', 'Hour', 'Day', 'Deliverable'],
    paymentModes: ['Bank transfer', 'UPI', 'Card', 'Cheque', 'International wire'],
    categories: { services: ['Design', 'Development', 'Marketing', 'Consulting', 'Retainer'] },
    designations: ['Designer', 'Developer', 'Account manager', 'Intern'],
    numbering: { invoices: 'INV', quotations: 'PROP' },
    dueDays: 15,
    design: 'modern',
    terms: 'Payment due within 15 days. 50% advance on proposals; source files are delivered on full payment.',
    dashboard: ['receivables', 'overdue', 'quotes_open', 'board:c_projects', 'sales_month'],
  },

  sample: {
    services: [
      { name: 'Website design & development', category: 'Development', unit: 'Project', taxRate: 18, priceMinor: rs(85000) },
      { name: 'Logo & brand identity', category: 'Design', unit: 'Project', taxRate: 18, priceMinor: rs(35000) },
      { name: 'Social media management', category: 'Retainer', unit: 'Month', taxRate: 18, priceMinor: rs(25000) },
      { name: 'SEO retainer', category: 'Marketing', unit: 'Month', taxRate: 18, priceMinor: rs(18000) },
      { name: 'Consulting', category: 'Consulting', unit: 'Hour', taxRate: 18, priceMinor: rs(3000) },
    ],
  },
};
