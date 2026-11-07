/**
 * O caminho do webhook contém o segredo (/webhooks/zapi/:secret). Nunca pode ir para os logs.
 */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/(\/webhooks\/[^/]+\/)[^/?#]+/, '$1[redacted]');
}

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["client-token"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
];
