import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * Opts a route out of the `{ success, message?, data }` envelope — the handler's return
 * value is sent exactly as written.
 *
 * For routes whose body shape belongs to somebody else: a payment provider's webhook
 * callback, an infrastructure healthcheck. Wrapping those would be changing a contract we
 * don't own — SePay reads the body it gets back, and a load balancer probe is not part of
 * the app's API.
 *
 * Not for "this response looks fine already". `ResponseEnvelopeInterceptor` already merges
 * rather than nests when a handler returns `data`/`success` itself, so ordinary routes
 * never need this.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
