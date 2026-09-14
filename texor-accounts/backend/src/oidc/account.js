/**
 * Bridges the User collection to the account shape oidc-provider expects.
 *
 * `findAccount` is called whenever the provider needs to put claims into an ID
 * token or a userinfo response. Returning `undefined` invalidates the session,
 * which is exactly what should happen if an account is suspended or deleted
 * while its session is still live.
 */
import User from '../models/User.js';

export async function findAccount(_ctx, sub) {
  const user = await User.findById(sub).exec();
  if (!user || user.status !== 'active') return undefined;

  const claims = user.toClaims();

  return {
    accountId: sub,
    /**
     * @param use   'id_token' or 'userinfo'
     * @param scope space-delimited scopes granted to the requesting product
     */
    async claims(use, scope) {
      const granted = new Set((scope || '').split(' ').filter(Boolean));
      const result = { sub: claims.sub };

      if (granted.has('profile')) {
        Object.assign(result, {
          name: claims.name,
          given_name: claims.given_name,
          family_name: claims.family_name,
          picture: claims.picture,
          locale: claims.locale,
          zoneinfo: claims.zoneinfo,
          updated_at: claims.updated_at,
        });
      }
      if (granted.has('email')) {
        result.email = claims.email;
        result.email_verified = claims.email_verified;
      }
      if (granted.has('phone') && claims.phone_number) {
        result.phone_number = claims.phone_number;
        result.phone_number_verified = claims.phone_number_verified;
      }

      return result;
    },
  };
}

export default findAccount;
