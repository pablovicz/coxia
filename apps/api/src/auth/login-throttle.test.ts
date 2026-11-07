import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle';

const status = (fn: () => void) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as HttpException).getStatus();
  }
};

describe('limite de tentativas de login', () => {
  it('bloqueia a 6ª tentativa errada do mesmo IP e e-mail, e libera depois da janela', () => {
    const t = new LoginThrottle(15 * 60_000, 5, 30);
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(status(() => t.check('1.1.1.1', 'ana@x.test', now))).toBe(200);
      t.fail('1.1.1.1', 'ana@x.test', now);
    }
    expect(status(() => t.check('1.1.1.1', 'ana@x.test', now))).toBe(429);
    // Outro IP ou outro e-mail não são afetados pelo limite por conta.
    expect(status(() => t.check('2.2.2.2', 'ana@x.test', now))).toBe(200);
    expect(status(() => t.check('1.1.1.1', 'bia@x.test', now))).toBe(200);
    expect(status(() => t.check('1.1.1.1', 'ana@x.test', now + 15 * 60_000 + 1))).toBe(200);
  });

  it('muitos e-mails a partir do mesmo IP também são bloqueados', () => {
    const t = new LoginThrottle(60_000, 5, 3);
    for (const e of ['a', 'b', 'c']) t.fail('9.9.9.9', e, 0);
    expect(status(() => t.check('9.9.9.9', 'd', 1))).toBe(429);
  });

  it('login certo zera o contador da conta', () => {
    const t = new LoginThrottle(60_000, 2, 30);
    t.fail('1.1.1.1', 'ana', 0);
    t.succeed('1.1.1.1', 'ana');
    t.fail('1.1.1.1', 'ana', 1);
    expect(status(() => t.check('1.1.1.1', 'ana', 2))).toBe(200);
  });
});
