/**
 * Industry packs: plain data describing how a workspace starts out.
 *
 * Applying a pack only writes ordinary workspace settings, fields and records,
 * so everything it sets up can be renamed, rearranged or removed afterwards.
 */
import agency from './agency.js';
import carWash from './car-wash.js';
import electronics from './electronics.js';
import garage from './garage.js';
import general from './general.js';
import restaurant from './restaurant.js';
import retail from './retail.js';
import salon from './salon.js';

export const INDUSTRIES = [carWash, restaurant, electronics, salon, garage, agency, retail, general];

const byKey = new Map(INDUSTRIES.map((pack) => [pack.key, pack]));
export const industry = (key) => byKey.get(key) ?? null;

