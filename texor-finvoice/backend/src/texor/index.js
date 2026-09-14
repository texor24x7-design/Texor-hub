/**
 * The product's single configured Texor client.
 *
 * Built once at import time so discovery is cached for the process lifetime.
 */
import env from '../config/env.js';
import { TexorClient } from './client.js';

export const texor = new TexorClient({
  issuer: env.TEXOR_ISSUER,
  clientId: env.TEXOR_CLIENT_ID,
  clientSecret: env.TEXOR_CLIENT_SECRET,
  redirectUri: env.TEXOR_REDIRECT_URI,
  postLogoutRedirectUri: env.appOrigin,
  scope: env.TEXOR_SCOPE,
  resource: env.TEXOR_RESOURCE,
});

export { TexorAuthError } from './client.js';
export * from './transaction.js';
export default texor;
