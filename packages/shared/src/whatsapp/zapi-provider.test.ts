import { describe, expect, it } from 'vitest';
import { WhatsappProviderError } from './provider';
import { toConnectCode, ZapiProvider } from './zapi-provider';

function providerReturning(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const p = new ZapiProvider({ baseUrl: 'https://api.z-api.io', instanceId: 'INST', instanceToken: 'TOK', clientToken: 'CT', fetchImpl });
  return { p, calls };
}

describe('Z-API: conexão por QR code e por código', () => {
  it('QR em base64 vira data URI; data URI é mantida', () => {
    expect(toConnectCode({ value: 'iVBORw0K' }, 'qr')).toEqual({ kind: 'qr', image: 'data:image/png;base64,iVBORw0K' });
    expect(toConnectCode({ value: 'data:image/png;base64,AAA' }, 'qr')).toEqual({ kind: 'qr', image: 'data:image/png;base64,AAA' });
  });

  it('desafio de chave de acesso e sessão já conectada', () => {
    expect(toConnectCode({ challenge: { rpId: 'whatsapp.com' } }, 'qr')).toEqual({ kind: 'challenge' });
    expect(toConnectCode({ connected: true }, 'code')).toEqual({ kind: 'connected' });
    expect(() => toConnectCode({}, 'qr')).toThrow(WhatsappProviderError);
  });

  it('chama qr-code/image e phone-code/{telefone só com dígitos}', async () => {
    const qr = providerReturning({ value: 'data:image/png;base64,QQ' });
    expect(await qr.p.getQrCode()).toEqual({ kind: 'qr', image: 'data:image/png;base64,QQ' });
    expect(qr.calls[0]).toBe('https://api.z-api.io/instances/INST/token/TOK/qr-code/image');

    const code = providerReturning({ value: 'A1B2C3D4' });
    expect(await code.p.getPhoneCode('+55 (11) 99999-0000')).toEqual({ kind: 'code', code: 'A1B2C3D4' });
    expect(code.calls[0]).toBe('https://api.z-api.io/instances/INST/token/TOK/phone-code/5511999990000');
  });

  it('desconectar chama disconnect; resposta negativa vira erro', async () => {
    const ok = providerReturning({ value: true });
    await ok.p.disconnect();
    expect(ok.calls[0]).toBe('https://api.z-api.io/instances/INST/token/TOK/disconnect');
    await expect(providerReturning({ value: false }).p.disconnect()).rejects.toBeInstanceOf(WhatsappProviderError);
  });

  it('perfil do contato: nome do WhatsApp (notify) e foto https', async () => {
    const { p, calls } = providerReturning({ name: 'Carla agenda', notify: 'Carla Mendes', short: 'Carla', imgUrl: 'https://pps.whatsapp.net/v/t61/abc.jpg' });
    expect(await p.getContactProfile('+55 11 98765-0002')).toEqual({ name: 'Carla Mendes', photoUrl: 'https://pps.whatsapp.net/v/t61/abc.jpg' });
    expect(calls[0]).toBe('https://api.z-api.io/instances/INST/token/TOK/contacts/5511987650002');
    expect(await providerReturning({ error: 'not found' }, 404).p.getContactProfile('5511987650002')).toBeNull();
    expect(await providerReturning({ notify: null, imgUrl: 'javascript:alert(1)' }).p.getContactProfile('5511987650002')).toEqual({ name: null, photoUrl: null });
  });

  it('erro HTTP não vaza o token da instância', async () => {
    const { p } = providerReturning({ error: 'x' }, 500);
    const err = (await p.getQrCode().catch((e: unknown) => e)) as WhatsappProviderError;
    expect(err).toBeInstanceOf(WhatsappProviderError);
    expect(err.message).not.toContain('TOK');
    expect(err.retryable).toBe(true);
  });

  it('participantes do grupo trazem o nome quando o provedor informa', async () => {
    const { p } = providerReturning({
      phone: '120363019502650977-group',
      subject: 'PROJETO - XPO',
      participants: [
        { phone: '5511888888888', isAdmin: false },
        { phone: '5511777777777', isAdmin: true, name: 'Bia Souza', short: 'Bia' },
        { phone: '81896604192873@lid', isAdmin: false },
      ],
    });
    const info = await p.getGroupInfo('120363019502650977-group');
    expect(info.participants).toEqual([
      { phone: '5511888888888', isAdmin: false, name: null },
      { phone: '5511777777777', isAdmin: true, name: 'Bia Souza' },
    ]);
  });
});
