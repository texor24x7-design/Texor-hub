import { randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { exportJWK, generateKeyPair } from 'jose';
const mongod = await MongoMemoryServer.create();
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(privateKey);
Object.assign(process.env, {
  NODE_ENV:'development', PORT:'4598', ISSUER_ORIGIN:'http://localhost:4598',
  ACCOUNTS_WEB_ORIGIN:'http://localhost:3999', CORS_ORIGINS:'http://localhost:3999',
  MONGODB_URI: mongod.getUri('t'), COOKIE_KEYS:'a,b',
  SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  OIDC_JWKS: JSON.stringify([{...jwk, use:'sig', alg:'RS256', kid:'test'}]), LOG_LEVEL:'error',
});
const B = new URL('../src/', import.meta.url).href;
const { connectDatabase } = await import(`${B}config/db.js`);
const { createProvider } = await import(`${B}oidc/provider.js`);
const { registerClient } = await import(`${B}services/client.service.js`);
await connectDatabase();
const provider = await createProvider();
const { client } = await registerClient({
  clientId:'finvoice', clientName:'Finvoice',
  redirectUris:['http://localhost:3001/api/auth/callback'],
  appUrl:'http://localhost:3001', resourceIndicator:'https://api.finvoice.texor.app',
  isFirstParty:true,
});
console.log('DB doc isFirstParty:', client.isFirstParty, '| resourceIndicator:', client.resourceIndicator);
console.log('metadata sent to provider:', JSON.stringify(client.toProviderMetadata('secret'), null, 1));
const c = await provider.Client.find('finvoice');
console.log('\nprovider Client found:', Boolean(c));
if (c) {
  console.log('c.firstParty =', c.firstParty);
  console.log('c.resourceIndicator =', c.resourceIndicator);
  console.log('own keys containing "irst":', Object.keys(c).filter(k=>/irst|esource/i.test(k)));
  console.log('metadata():', JSON.stringify(c.metadata?.(), null, 1)?.slice(0, 600));
}
await (await import('mongoose')).default.disconnect(); await mongod.stop(); process.exit(0);
