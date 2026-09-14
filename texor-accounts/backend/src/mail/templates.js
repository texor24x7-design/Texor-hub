/**
 * Email content.
 *
 * Every message is built as both HTML and plain text. The text part is not a
 * courtesy — a link that only exists inside HTML is invisible to anyone whose
 * client blocks it, and it is what the development transport prints.
 *
 * The markup is deliberately plain: tables and inline styles, because email
 * clients remain a decade behind browsers, and nothing that depends on
 * JavaScript, external CSS or web fonts.
 */
import env from '../config/env.js';

const escape = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function layout({ heading, body, action, footer }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escape(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;padding:32px;">
        <tr><td style="padding-bottom:24px;">
          <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background:#4338ca;color:#ffffff;font-weight:700;font-size:14px;">T</span>
          <span style="font-size:16px;font-weight:600;color:#17181d;padding-left:8px;vertical-align:middle;">${escape(env.APP_NAME)}</span>
        </td></tr>
        <tr><td style="font-size:20px;font-weight:650;color:#17181d;padding-bottom:12px;">${escape(heading)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#3f4149;padding-bottom:24px;">${body}</td></tr>
        ${action ? `<tr><td style="padding-bottom:24px;">
          <a href="${escape(action.url)}" style="display:inline-block;background:#4338ca;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:9px;">${escape(action.label)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#6b6d78;padding-bottom:24px;">
          If the button does not work, copy this link into your browser:<br>
          <a href="${escape(action.url)}" style="color:#4338ca;word-break:break-all;">${escape(action.url)}</a>
        </td></tr>` : ''}
        <tr><td style="border-top:1px solid #e6e6ec;padding-top:20px;font-size:13px;line-height:1.6;color:#8a8c98;">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function verifyEmail({ url, displayName, expiresInMinutes }) {
  return {
    subject: `Confirm your email address for ${env.APP_NAME}`,
    html: layout({
      heading: 'Confirm your email address',
      body: `Hi ${escape(displayName)},<br><br>Confirm this address to finish setting up your ${escape(env.APP_NAME)} Account. The link expires in ${expiresInMinutes} minutes.`,
      action: { url, label: 'Confirm email address' },
      footer: `If you did not create a ${escape(env.APP_NAME)} Account, you can ignore this email — nothing will happen.`,
    }),
    text: [
      `Hi ${displayName},`,
      '',
      `Confirm this address to finish setting up your ${env.APP_NAME} Account.`,
      `The link expires in ${expiresInMinutes} minutes.`,
      '',
      url,
      '',
      `If you did not create a ${env.APP_NAME} Account, you can ignore this email.`,
    ].join('\n'),
  };
}

export function resetPassword({ url, displayName, expiresInMinutes }) {
  return {
    subject: `Reset your ${env.APP_NAME} password`,
    html: layout({
      heading: 'Reset your password',
      body: `Hi ${escape(displayName)},<br><br>Use the button below to choose a new password. The link expires in ${expiresInMinutes} minutes and can be used once.`,
      action: { url, label: 'Choose a new password' },
      footer: 'If you did not ask to reset your password, you can ignore this email. Your current password still works, and nobody has been given access.',
    }),
    text: [
      `Hi ${displayName},`,
      '',
      'Use the link below to choose a new password.',
      `It expires in ${expiresInMinutes} minutes and can be used once.`,
      '',
      url,
      '',
      'If you did not ask to reset your password, you can ignore this email.',
      'Your current password still works.',
    ].join('\n'),
  };
}

export function passwordChanged({ displayName }) {
  return {
    subject: `Your ${env.APP_NAME} password was changed`,
    html: layout({
      heading: 'Your password was changed',
      body: `Hi ${escape(displayName)},<br><br>The password on your ${escape(env.APP_NAME)} Account was just changed, and every other signed-in device was signed out.`,
      footer: 'If this was not you, reset your password immediately and review the devices signed in to your account.',
    }),
    text: [
      `Hi ${displayName},`,
      '',
      `The password on your ${env.APP_NAME} Account was just changed, and every other`,
      'signed-in device was signed out.',
      '',
      'If this was not you, reset your password immediately.',
    ].join('\n'),
  };
}
