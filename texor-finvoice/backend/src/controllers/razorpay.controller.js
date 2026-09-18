import * as razorpay from '../services/razorpay.service.js';

export const { razorpaySchema } = razorpay;

export const save = async (req, res) => res.json(await razorpay.save(req, req.body));
export const link = async (req, res) => res.json(await razorpay.linkFor(req, req.params.id));
