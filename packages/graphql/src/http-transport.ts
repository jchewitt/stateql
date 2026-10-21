import { ReadTransportError } from '@tandrove/core';
import type { GraphQLTransport } from './client.js';

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) {
    const ms = Number(value) * 1000;
    return Math.min(ms, Number.MAX_SAFE_INTEGER);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Default read-only HTTP transport. Classification never includes decoding. */
export function httpTransport(options: {
  readonly endpoint: string;
  readonly headers?: () => Readonly<Record<string, string>>;
}): GraphQLTransport {
  const url = new URL(options.endpoint);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Expected an HTTP(S) endpoint.');
  return async (operation, context) => {
    // Build before the network catch: invalid headers/configuration are not transient.
    const request = new Request(url, {
      method: 'POST',
      ...(context === undefined ? {} : { signal: context.signal }),
      headers: { 'content-type': 'application/json', ...options.headers?.() },
      body: JSON.stringify({
        query: operation.query,
        variables: operation.variables,
      }),
    });
    let response: Response;
    try {
      response = await fetch(request);
    } catch (cause) {
      if (context?.signal.aborted) throw context.signal.reason;
      throw new ReadTransportError('GraphQL network request failed.', {
        retryable: true,
        cause,
      });
    }
    if (!response.ok) {
      const delay = retryAfter(response.headers.get('retry-after'));
      // Release the failed response before another attempt opens a connection.
      try {
        await response.body?.cancel();
      } catch {
        // Body cleanup cannot replace the HTTP failure.
      }
      throw new ReadTransportError(
        `GraphQL HTTP request failed (${response.status}).`,
        {
          retryable: transientStatuses.has(response.status),
          ...(delay === undefined ? {} : { retryAfterMs: delay }),
        },
      );
    }
    let body: string;
    try {
      body = await response.text();
    } catch (cause) {
      if (context?.signal.aborted) throw context.signal.reason;
      throw new ReadTransportError('GraphQL response body transfer failed.', {
        retryable: true,
        cause,
      });
    }
    // Fully received invalid JSON and GraphQL decoding remain unclassified.
    return JSON.parse(body) as unknown;
  };
}
