/**
 * One pay period, and the payslips produced for it.
 *
 * Payslips are embedded rather than referenced because they are only ever read
 * with their run, and because a completed run must be immutable: the figures
 * are frozen copies, not live lookups into the employee record. Changing
 * someone's salary tomorrow must not rewrite what they were paid last month.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const payslipSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    employeeName: { type: String, required: true },
    jobTitle: { type: String, default: '' },

    gross: { type: Number, required: true, min: 0 },
    tax: { type: Number, required: true, min: 0 },
    pension: { type: Number, required: true, min: 0 },
    net: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const payRunSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerTexorId: { type: String, required: true, index: true },

    label: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    payDate: { type: Date, required: true },

    frequency: { type: String, enum: ['weekly', 'fortnightly', 'monthly'], default: 'monthly' },
    currency: { type: String, default: 'USD', uppercase: true },

    status: { type: String, enum: ['draft', 'approved', 'paid'], default: 'draft', index: true },
    approvedAt: { type: Date, default: null },

    payslips: { type: [payslipSchema], default: [] },

    totalGross: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    totalPension: { type: Number, default: 0 },
    totalNet: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const PERIODS_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12 };
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Builds the payslips for a set of employees.
 *
 * Kept as a static rather than a hook because a run is calculated once, on
 * demand — recalculating an approved run on every save is exactly the bug this
 * design is meant to prevent.
 */
payRunSchema.statics.buildPayslips = function buildPayslips(employees, frequency) {
  const periods = PERIODS_PER_YEAR[frequency] ?? 12;

  return employees.map((employee) => {
    const gross = money(employee.annualSalary / periods);
    const tax = money(gross * (employee.taxRate / 100));
    const pension = money(gross * (employee.pensionRate / 100));

    return {
      employee: employee._id,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      jobTitle: employee.jobTitle,
      gross,
      tax,
      pension,
      net: money(gross - tax - pension),
    };
  });
};

payRunSchema.methods.recalculateTotals = function recalculateTotals() {
  const sum = (key) => money(this.payslips.reduce((total, slip) => total + slip[key], 0));

  this.totalGross = sum('gross');
  this.totalTax = sum('tax');
  this.totalPension = sum('pension');
  this.totalNet = sum('net');

  return this;
};

export const PayRun = mongoose.model('PayRun', payRunSchema);
export default PayRun;
