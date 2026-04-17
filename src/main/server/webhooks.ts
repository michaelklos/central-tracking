import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import type { Database } from '../database/database';
import { getWebhookSubscribers, type WebhookSubscriber } from '../ipc/pluginHandlers';
import type { WebhookEvent } from '../../shared/types';

/**
 * Computes `sha256=<hex>` HMAC of the payload body using the session token.
 * Plugins verify by recomputing with the same token (provided via env when
 * the plugin is launched by `ct plugin run`).
 */
export function signWebhookPayload(token: string, body: string): string {
  const hmac = crypto.createHmac('sha256', token);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

export function subscriberMatchesEvent(sub: WebhookSubscriber, event: string): boolean {
  if (!sub.events || sub.events.length === 0) return false;
  if (sub.events.includes('*')) return true;
  return sub.events.includes(event);
}

const DELIVERY_TIMEOUT_MS = 5000;

/**
 * Fire-and-forget HTTP POST to a single subscriber URL. Errors are returned
 * via callback; callers decide whether to log. We never throw — webhook
 * failures must not break the originating mutation.
 */
export function deliverWebhook(
  url: string,
  body: string,
  signature: string,
  pluginId: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({ ok: false, error: `invalid url: ${(err as Error).message}` });
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-CT-Signature': signature,
        'X-CT-Plugin-Id': pluginId,
      },
    };

    const req = client.request(options, (res) => {
      res.on('data', () => { /* drain */ });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status });
      });
    });

    req.setTimeout(DELIVERY_TIMEOUT_MS, () => {
      req.destroy(new Error('webhook delivery timeout'));
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Dispatch an event to every matching plugin webhook subscriber. Runs
 * asynchronously (not awaited by callers) — mutations complete before any
 * webhook delivery begins.
 *
 * `logger` receives one line per delivery failure; use a no-op for tests.
 */
export function dispatchEvent(
  db: Database,
  token: string,
  event: WebhookEvent,
  logger: (msg: string) => void = () => {},
): Promise<void> {
  const body = JSON.stringify(event);
  const signature = signWebhookPayload(token, body);
  const subscribers = getWebhookSubscribers(db).filter((s) => subscriberMatchesEvent(s, event.event));

  return Promise.all(
    subscribers.map(async (sub) => {
      const result = await deliverWebhook(sub.url, body, signature, sub.pluginId);
      if (!result.ok) {
        logger(`[webhook] plugin=${sub.pluginId} event=${event.event} failed: ${result.error ?? `status ${result.status}`}`);
      }
    }),
  ).then(() => undefined);
}
