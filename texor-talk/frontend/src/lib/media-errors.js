/**
 * Turning a `getUserMedia` failure into something worth reading.
 *
 * These all arrive as a `DOMException` whose `name` is the only reliable part —
 * the `message` differs between browsers and is usually written for whoever is
 * debugging the browser rather than for whoever is trying to join a meeting.
 *
 * Saying "could not use your microphone" for every one of them, which is what
 * this replaced, is the worst possible answer: a blocked permission, a missing
 * device and a microphone another application has already taken need three
 * completely different things done about them, and the person reading has no
 * way to tell which one they have.
 */

const DEVICE = { audio: 'microphone', video: 'camera' };

export function describeMediaError(error, kind = 'audio') {
  const thing = DEVICE[kind] ?? 'device';

  switch (error?.name) {
    case 'NotAllowedError':
      /**
       * Both "the user clicked Block" and "a policy blocks it" arrive here, and
       * so does "the prompt was dismissed". The advice is the same in all
       * three, and it is advice rather than blame because we cannot tell them
       * apart.
       */
      return `Your ${thing} is blocked. Allow it from the icon in your browser’s address bar, then try again.`;

    case 'NotFoundError':
    case 'OverconstrainedError':
      return error?.name === 'OverconstrainedError'
        ? `The ${thing} you chose is no longer available. Pick another one.`
        : `No ${thing} was found. Check it is plugged in and not disabled.`;

    case 'NotReadableError':
    case 'AbortError':
      // Windows in particular hands a device to one application exclusively.
      return `Your ${thing} is being used by another application. Close it and try again.`;

    case 'SecurityError':
      return `Your browser will only share a ${thing} over a secure connection.`;

    default:
      return error?.message
        ? `Could not use your ${thing}: ${error.message}`
        : `Could not use your ${thing}.`;
  }
}

export default { describeMediaError };
