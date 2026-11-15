import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SubmitThrottle } from './quote-requests.controller';

describe('limite do formulário público', () => {
  it('5 envios por IP na janela; outro IP segue; a janela passa e libera', () => {
    const t = new SubmitThrottle(60_000, 5, 100);
    for (let i = 0; i < 5; i++) t.hit('1.1.1.1', 1000 + i);
    expect(() => t.hit('1.1.1.1', 2000)).toThrow(HttpException);
    expect(() => t.hit('2.2.2.2', 2000)).not.toThrow();
    expect(() => t.hit('1.1.1.1', 70_000)).not.toThrow();
  });

  it('limite total protege contra muitos IPs', () => {
    const t = new SubmitThrottle(60_000, 5, 3);
    t.hit('a', 1);
    t.hit('b', 2);
    t.hit('c', 3);
    expect(() => t.hit('d', 4)).toThrow(/Muitos envios/);
  });
});
