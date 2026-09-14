/**
 * Someone on the payroll.
 *
 * `texorId` is optional and nullable: most employees are just records here, but
 * linking one to a Texor Account lets that person sign in and see their own
 * payslips without being given access to the whole payroll.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const employeeSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerTexorId: { type: String, required: true, index: true },

    // Set when this employee also has a Texor Account.
    texorId: { type: String, default: null, index: true },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },

    jobTitle: { type: String, default: '' },
    department: { type: String, default: '' },

    // Annual gross, in the employer's pay currency.
    annualSalary: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, min: 0, max: 100, default: 20 },
    pensionRate: { type: Number, min: 0, max: 100, default: 0 },

    startDate: { type: Date, default: () => new Date() },
    endDate: { type: Date, default: null },

    status: { type: String, enum: ['active', 'on_leave', 'terminated'], default: 'active', index: true },
  },
  { timestamps: true },
);

employeeSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

employeeSchema.set('toJSON', { virtuals: true });

export const Employee = mongoose.model('Employee', employeeSchema);
export default Employee;
