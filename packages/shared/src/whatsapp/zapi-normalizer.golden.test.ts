import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inboundMessage } from '@coxia/contracts';
import { describe, expect, it } from 'vitest';
import { normalizeZapiWebhook } from './zapi-normalizer';

/**
 * Golden tests do normalizador Z-API.
 * Entrada: tests/fixtures/zapi/*.json  →  saída aprovada: tests/golden/zapi/*.json
 * Para aprovar uma mudança intencional: UPDATE_GOLDEN=1 pnpm --filter @coxia/shared test
 * e revisar o diff no PR. O CI nunca define UPDATE_GOLDEN.
 */
const root = join(__dirname, '..', '..', '..', '..');
const fixturesDir = join(root, 'tests', 'fixtures', 'zapi');
const goldenDir = join(root, 'tests', 'golden', 'zapi');
const update = process.env.UPDATE_GOLDEN === '1';

const load = (name: string) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.json') && f !== 'manifest.json');

describe('golden: normalizeZapiWebhook', () => {
  it('toda fixture está documentada no manifest', () => {
    const manifest = load('manifest.json') as { fixtures: Record<string, unknown> };
    expect(Object.keys(manifest.fixtures).sort()).toEqual([...fixtures].sort());
  });

  it.each(fixtures)('%s', (name) => {
    const normalized = normalizeZapiWebhook(load(name));
    if (normalized) expect(() => inboundMessage.parse(normalized)).not.toThrow();

    const goldenPath = join(goldenDir, name);
    if (update) {
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(goldenPath, JSON.stringify(normalized, null, 2) + '\n');
    }
    if (!existsSync(goldenPath)) {
      throw new Error(`golden ausente: ${goldenPath}. Rode com UPDATE_GOLDEN=1 e revise o resultado.`);
    }
    expect(normalized).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
  });
});

describe('regras de normalização', () => {
  it('grupo usa o ID do grupo como chave e o participante como remetente', () => {
    const m = normalizeZapiWebhook(load('text-group-first-message.json'))!;
    expect(m.chat).toEqual({ id: '120363019502650977-group', isGroup: true, name: 'PROJETO - XPO' });
    expect(m.sender.phone).toBe('5511977776666');
  });

  it('renomear o grupo mantém o mesmo chat.id', () => {
    const before = normalizeZapiWebhook(load('text-group-first-message.json'))!;
    const after = normalizeZapiWebhook(load('text-group-after-rename.json'))!;
    expect(after.chat.id).toBe(before.chat.id);
    expect(after.chat.name).not.toBe(before.chat.name);
  });

  it('fromMe identifica o número conectado como remetente', () => {
    const m = normalizeZapiWebhook(load('text-group-from-me.json'))!;
    expect(m.fromMe).toBe(true);
    expect(m.sender.phone).toBe('5511900000000');
  });

  it('reenvio do mesmo webhook gera a mesma dedupeKey', () => {
    const a = normalizeZapiWebhook(load('image-group-receipt.json'))!;
    const b = normalizeZapiWebhook(load('image-group-receipt.json'))!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).toBe('zapi:3E1A2B3C4D5E6F708192A3B4C5D6E7F8:3EB0A1B2C3D4E5F60004');
  });

  it('evento sem messageId recebe chave determinística estável', () => {
    const payload = load('notification-participant-add-no-id.json');
    const a = normalizeZapiWebhook(payload)!;
    const b = normalizeZapiWebhook({ ...payload })!;
    expect(a.providerMessageId).toBeNull();
    expect(a.dedupeKey).toMatch(/^zapi:3E1A2B3C4D5E6F708192A3B4C5D6E7F8:evt-[0-9a-f]{64}$/);
    expect(b.dedupeKey).toBe(a.dedupeKey);
    const other = normalizeZapiWebhook({ ...payload, notificationParameters: ['5511000000000'] })!;
    expect(other.dedupeKey).not.toBe(a.dedupeKey);
  });

  it('áudio PTT preserva URL, duração e mime type', () => {
    const m = normalizeZapiWebhook(load('audio-group-briefing.json'))!;
    expect(m.kind).toBe('audio');
    expect(m.media).toMatchObject({ voiceNote: true, seconds: 94, mimeType: 'audio/ogg; codecs=opus' });
  });

  it('callback de status é ignorado', () => {
    expect(normalizeZapiWebhook(load('status-callback-ignored.json'))).toBeNull();
  });

  it('payload sem instanceId é rejeitado', () => {
    expect(() => normalizeZapiWebhook({ type: 'ReceivedCallback', phone: '1' })).toThrow(/instanceId/);
  });
});
