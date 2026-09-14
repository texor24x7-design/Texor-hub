/**
 * The bridge between oidc-provider and the Next.js account UI.
 *
 * When a product sends a user to /oidc/auth, the provider decides what it needs
 * (a login, a consent) and redirects the browser to the account UI. The UI then
 * talks to these three endpoints:
 *
 *   GET  /api/interaction/:uid          what does the provider want?
 *   POST /api/interaction/:uid/login    here are the credentials
 *   POST /api/interaction/:uid/confirm  the user approved the requested scopes
 *   POST /api/interaction/:uid/abort    the user declined
 *
 * Rather than 303-ing the browser itself (which a fetch() cannot follow into a
 * cross-origin redirect chain), each endpoint returns a `redirectTo` URL and
 * lets the UI navigate. That keeps the flow debuggable in the network tab.
 */
import { z } from 'zod';
import Client from '../models/Client.js';
import ApiError from '../utils/ApiError.js';
import { authenticate, toPublicUser } from '../services/user.service.js';
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
} from '../services/session.service.js';
import { loginSchema } from './auth.controller.js';
import { publicProviders } from '../federation/providers.js';
import { describeScopes } from '../config/scopes.js';

export const interactionLoginSchema = loginSchema;

export const confirmSchema = z.object({
  // Scopes the user actually ticked. Omitted means "everything requested".
  scopes: z.array(z.string()).optional(),
});

/**
 * `provider` is injected in routes/index.js rather than imported, because the
 * provider is built asynchronously at boot (it has to load signing keys first).
 */
export const makeInteractionController = (provider) => ({
  async details(req, res) {
    const interaction = await provider.interactionDetails(req, res);
    const { uid, prompt, params, session } = interaction;

    const client = await Client.findOne({ clientId: params.client_id }).lean();

    res.json({
      uid,
      prompt: {
        name: prompt.name,
        reasons: prompt.reasons,
        details: prompt.details,
      },
      params: {
        clientId: params.client_id,
        scope: params.scope,
        resource: params.resource,
      },
      // Rendered on the consent screen, so the catalogue is the single place
      // scope wording is written.
      scopeDetails: describeScopes((params.scope ?? '').split(' ').filter(Boolean)),
      client: client
        ? {
          clientId: client.clientId,
          name: client.clientName,
          description: client.description,
          logoUri: client.logoUri,
          appUrl: client.appUrl,
          policyUri: client.policyUri,
          tosUri: client.tosUri,
          supportEmail: client.supportEmail,
          firstParty: client.isFirstParty,
          // Drives the "this app has not been verified by Texor" warning.
          // A third-party app that nobody has reviewed should say so before
          // someone hands it their account.
          publishingStatus: client.publishingStatus
            ?? (client.isFirstParty ? 'published' : 'testing'),
          verified: Boolean(client.isFirstParty) || client.publishingStatus === 'published',
        }
        : null,
      // The already-signed-in account, if any — lets the UI offer "continue as".
      session: session?.accountId ? { accountId: session.accountId } : null,
      user: req.user ? toPublicUser(req.user) : null,
      // So the sign-in prompt inside an authorization request offers the same
      // Google / Microsoft / LinkedIn buttons as the standalone sign-in page.
      providers: publicProviders(),
    });
  },

  /**
   * Completes a `login` prompt.
   *
   * If the browser already carries a valid Texor session, no credentials are
   * needed — this is the path that makes the second and third product in the
   * ecosystem sign in without a prompt.
   */
  async login(req, res) {
    const interaction = await provider.interactionDetails(req, res);

    if (interaction.prompt.name !== 'login') {
      throw ApiError.badRequest('This step is not asking for a sign-in.');
    }

    let user = null;

    if (req.body?.useExistingSession) {
      if (!req.user) throw ApiError.unauthorized('No active Texor session.');
      user = req.user;
    } else {
      const parsed = interactionLoginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw ApiError.badRequest('Enter your email and password.', parsed.error.issues);
      }
      user = await authenticate(parsed.data);

      // Establish the SSO session alongside the provider's own.
      const token = await createSession(user._id, {
        userAgent: req.get('user-agent') ?? '',
        ip: req.ip ?? '',
      });
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    }

    const redirectTo = await provider.interactionResult(
      req,
      res,
      {
        login: {
          accountId: user._id.toString(),
          remember: true,
        },
      },
      { mergeWithLastSubmission: false },
    );

    res.json({ redirectTo, user: toPublicUser(user) });
  },

  /** Completes a `consent` prompt by building or extending the Grant. */
  async confirm(req, res) {
    const interaction = await provider.interactionDetails(req, res);
    const { prompt, params, session, grantId } = interaction;

    if (prompt.name !== 'consent') {
      throw ApiError.badRequest('This step is not asking for consent.');
    }
    if (!session?.accountId) {
      throw ApiError.unauthorized('Sign in before granting access.');
    }

    const grant = grantId
      ? await provider.Grant.find(grantId)
      : new provider.Grant({ accountId: session.accountId, clientId: params.client_id });

    const requested = prompt.details.missingOIDCScope ?? [];
    const approved = req.body?.scopes?.length
      ? requested.filter((scope) => req.body.scopes.includes(scope))
      : requested;

    if (approved.length) grant.addOIDCScope(approved.join(' '));

    if (prompt.details.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(prompt.details.missingResourceScopes)) {
        grant.addResourceScope(indicator, scopes.join(' '));
      }
    }

    const savedGrantId = await grant.save();

    const redirectTo = await provider.interactionResult(
      req,
      res,
      { consent: { grantId: savedGrantId } },
      { mergeWithLastSubmission: true },
    );

    res.json({ redirectTo });
  },

  /** The user said no. Hands the product a standard `access_denied`. */
  async abort(req, res) {
    const redirectTo = await provider.interactionResult(
      req,
      res,
      {
        error: 'access_denied',
        error_description: 'The user declined the request.',
      },
      { mergeWithLastSubmission: false },
    );

    res.json({ redirectTo });
  },
});

export default makeInteractionController;
