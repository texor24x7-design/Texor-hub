/**
 * The Texor developer console API.
 *
 * Anyone with a Texor Account can register an app here and get credentials for
 * "Sign in with Texor" — the same mechanism Texor's own products use. What a
 * self-service developer cannot do is grant themselves first-party status or
 * publish their own app; both live behind the admin routes.
 */
import { z } from 'zod';
import { SCOPES } from '../config/scopes.js';
import env from '../config/env.js';
import {
  LIMITS,
  createApp,
  deleteApp,
  listAppsFor,
  listTestAccounts,
  loadOwnedApp,
  rotateSecret,
  setTestAccounts,
  submitForReview,
  toConsoleApp,
  updateApp,
} from '../services/app.service.js';

const optionalUrl = z.url().or(z.literal('')).optional();

export const createAppSchema = z.object({
  clientName: z.string().min(2, 'Give your app a name.').max(80),
  description: z.string().max(500).optional().default(''),
  redirectUris: z.array(z.string().min(1)).min(1, 'Add at least one redirect URI.'),
  postLogoutRedirectUris: z.array(z.string().min(1)).optional().default([]),
  allowedScopes: z.array(z.string()).optional(),
  tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']).optional(),
  logoUri: optionalUrl,
  appUrl: optionalUrl,
  policyUri: optionalUrl,
  tosUri: optionalUrl,
  supportEmail: z.email().or(z.literal('')).optional(),
});

// Everything is optional on update, and unknown keys are ignored by the service.
export const updateAppSchema = createAppSchema.partial();

export const testAccountsSchema = z.object({
  emails: z.array(z.string()).max(LIMITS.testAccounts),
});

/** The scope catalogue, so the console can render real descriptions. */
export function getScopes(_req, res) {
  res.json({
    scopes: SCOPES.map((scope) => ({
      id: scope.id,
      title: scope.title,
      description: scope.description,
      required: Boolean(scope.required),
      sensitive: scope.sensitive,
    })),
    limits: LIMITS,
    endpoints: {
      issuer: env.issuer,
      discovery: `${env.issuer}/.well-known/openid-configuration`,
    },
  });
}

export async function listApps(req, res) {
  res.json({ apps: await listAppsFor(req.user) });
}

export async function postApp(req, res) {
  const { app, clientSecret } = await createApp(req.user, req.body);

  res.status(201).json({
    app,
    // Shown exactly once. There is no endpoint that reveals it afterwards —
    // only rotation, which invalidates the old one.
    clientSecret,
  });
}

export async function getApp(req, res) {
  const client = await loadOwnedApp(req.params.clientId, req.user);

  res.json({
    app: toConsoleApp(client),
    testAccountEmails: await listTestAccounts(client),
  });
}

export async function patchApp(req, res) {
  const client = await loadOwnedApp(req.params.clientId, req.user);
  res.json({ app: await updateApp(client, req.body) });
}

export async function deleteAppHandler(req, res) {
  const client = await loadOwnedApp(req.params.clientId, req.user);
  await deleteApp(client);
  res.json({ ok: true });
}

export async function postRotateSecret(req, res) {
  const client = await loadOwnedApp(req.params.clientId, req.user);
  const { app, clientSecret } = await rotateSecret(client);

  res.json({ app, clientSecret });
}

export async function putTestAccounts(req, res) {
  const client = await loadOwnedApp(req.params.clientId, req.user);
  const { app, unknown } = await setTestAccounts(client, req.body.emails);

  res.json({
    app,
    testAccountEmails: await listTestAccounts(client),
    // Reported rather than silently dropped: a tester who cannot sign in and
    // does not know why is a support ticket waiting to happen.
    unknown,
  });
}

export async function postSubmitForReview(req, res) {
  const client = await loadOwnedApp(req.params.clientId, req.user);
  res.json({ app: await submitForReview(client) });
}
