import * as people from '../services/people.service.js';

export const list = async (req, res) => res.json(await people.list(req));
