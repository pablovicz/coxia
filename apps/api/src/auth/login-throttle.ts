import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Limite de tentativas de login (força bruta). Em memória: suficiente com uma réplica da api,
 * que é o desenho do MVP. Com várias réplicas, mover para o Redis.
 * - 5 falhas por (IP, e-mail) em 15 min;
 * - 30 falhas por IP em 15 min (vários e-mails a partir do mesmo lugar).
 * Login certo zera o contador daquele e-mail.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 15 * 60_000,
    private readonly perAccount = 5,
    private readonly perIp = 30,
    private readonly maxKeys = 50_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Lança 429 com Retry-After se o limite foi atingido. */
  check(ip: string, email: string, now = Date.now()): void {
    for (const [key, limit] of [[`a:${ip}|${email}`, this.perAccount], [`i:${ip}`, this.perIp]] as const) {
      const list = this.recent(key, now);
      if (list.length >= limit) {
        const retryAfter = Math.ceil((list[0]! + this.windowMs - now) / 1000);
        throw new HttpException(
          { statusCode: 429, message: 'Muitas tentativas. Tente de novo em alguns minutos.', retryAfterSeconds: retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  fail(ip: string, email: string, now = Date.now()): void {
    if (this.failures.size > this.maxKeys) this.failures.clear(); // proteção de memória
    for (const key of [`a:${ip}|${email}`, `i:${ip}`]) this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(ip: string, email: string): void {
    this.failures.delete(`a:${ip}|${email}`);
  }
}
