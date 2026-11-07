import { describe, expect, it } from 'vitest';
import { redactUrl } from './log-redaction';

describe('redactUrl', () => {
  it('esconde o segredo do webhook', () => {
    expect(redactUrl('/webhooks/zapi/s3cr3t-value-123')).toBe('/webhooks/zapi/[redacted]');
    expect(redactUrl('/webhooks/zapi/s3cr3t?x=1')).toBe('/webhooks/zapi/[redacted]?x=1');
  });
  it('não altera outras rotas', () => {
    expect(redactUrl('/health')).toBe('/health');
    expect(redactUrl('/auth/login')).toBe('/auth/login');
  });
});
