/** Envio de e-mail (convites de acesso e de reservas dos residentes). */

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

export class EmailProviderError extends Error {
  constructor(
    message: string,
    /** false: não adianta tentar de novo (ex.: endereço inválido, domínio não verificado). */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

/** "Casa Kaju <reservas@casakaju.com>" → nome e e-mail. */
export function parseMailbox(value: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (m) return { name: m[1]!.replace(/^"|"$/g, '') || m[2]!, email: m[2]!.trim() };
  return { name: value.trim(), email: value.trim() };
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email), sem SDK. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage) {
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content, 'utf8').toString('base64'),
            content_type: a.contentType,
          })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new EmailProviderError(`resend: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 429 (limite) e 5xx: tenta de novo com backoff; 4xx: erro de dados, vai para o dead-letter.
      throw new EmailProviderError(`resend ${res.status}: ${body.slice(0, 500)}`, res.status === 429 || res.status >= 500);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerMessageId: json.id ?? null };
  }
}

/** Desenvolvimento e testes: guarda as mensagens em memória. */
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
