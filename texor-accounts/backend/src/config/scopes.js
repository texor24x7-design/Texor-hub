/**
 * The scope catalogue.
 *
 * Every scope a developer can request is described here once: the provider
 * advertises it, the console offers it, and the consent screen explains it in
 * the user's words rather than the protocol's.
 *
 * `sensitive` scopes are the ones that would let an app read something a person
 * would be upset to lose control of. Requesting one puts an app into review
 * before it can be published — which is the whole reason the flag exists,
 * rather than trusting developers to self-select.
 */
export const SCOPES = [
  {
    id: 'openid',
    title: 'Confirm your identity',
    description: 'Your unique Texor account ID.',
    required: true,
    sensitive: false,
  },
  {
    id: 'profile',
    title: 'See your basic profile',
    description: 'Your name, picture, language and time zone.',
    sensitive: false,
  },
  {
    id: 'email',
    title: 'See your email address',
    description: 'The email address on your Texor Account.',
    sensitive: false,
  },
  {
    id: 'phone',
    title: 'See your phone number',
    description: 'The phone number on your Texor Account.',
    // Not every app needs a phone number, and the ones that ask should have to
    // say so. Marked sensitive so that adding it to a published app sends it
    // back through review.
    sensitive: true,
  },
  {
    id: 'offline_access',
    title: 'Stay signed in',
    description: 'Keep you signed in to the app without asking again each time.',
    sensitive: false,
  },
];

const BY_ID = new Map(SCOPES.map((scope) => [scope.id, scope]));

export const SCOPE_IDS = SCOPES.map((scope) => scope.id);

/** `openid` is not optional — every OIDC request carries it. */
export const REQUIRED_SCOPES = SCOPES.filter((scope) => scope.required).map((scope) => scope.id);

export const SENSITIVE_SCOPES = SCOPES.filter((scope) => scope.sensitive).map((scope) => scope.id);

export const getScope = (id) => BY_ID.get(id) ?? null;

export const isKnownScope = (id) => BY_ID.has(id);

/** Human-readable entries for the consent screen and the console. */
export const describeScopes = (ids) =>
  ids.filter(isKnownScope).map((id) => {
    const scope = BY_ID.get(id);
    return { id, title: scope.title, description: scope.description, sensitive: scope.sensitive };
  });

/** True when a scope set needs a human to look at the app before it goes live. */
export const requiresReview = (ids) => ids.some((id) => SENSITIVE_SCOPES.includes(id));
