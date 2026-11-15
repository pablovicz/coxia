'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { SEGMENTS, SERVICES, type ServiceKey, SITE } from '@/lib/content';
import { maskPhone, type QuoteErrors, readQuoteForm } from '@/lib/quote';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const field =
  'mt-1.5 block w-full rounded-md border-0 bg-kaju-field px-3 py-2.5 text-[15px] text-kaju-green-deep placeholder:text-kaju-green-deep/45 focus:outline-3 focus:outline-kaju-rose';
const label = 'block text-sm font-semibold text-kaju-cream';
const errorText = 'mt-1 text-sm font-semibold text-kaju-pink';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; name: string } | { kind: 'failed'; message: string };

/**
 * "Solicite um orçamento": vai para a Coxia (módulo de orçamentos), que avisa as
 * administradoras no WhatsApp. O resto da conversa segue pelo WhatsApp.
 */
export function QuoteForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [errors, setErrors] = useState<QuoteErrors>({});
  const [phone, setPhone] = useState('');
  const [preset, setPreset] = useState<{ service: ServiceKey | null; interest: string | null }>({ service: null, interest: null });

  // Botões do site trazem o serviço (?servico=) e o interesse (?interesse=) já escolhidos.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const service = q.get('servico');
    setPreset({
      service: SERVICES.some((s) => s.key === service) ? (service as ServiceKey) : null,
      interest: q.get('interesse')?.slice(0, 120) ?? null,
    });
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { payload, errors: found } = readQuoteForm(new FormData(e.currentTarget));
    setErrors(found);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setState({ kind: 'sending' });
    try {
      const res = await fetch(`${API_URL}/public/quote-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setState({ kind: 'sent', name: payload.name.split(' ')[0] ?? '' });
        window.scrollTo({ top: 0 });
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setState({ kind: 'failed', message: body?.message ?? 'Não foi possível enviar agora.' });
    } catch {
      setState({ kind: 'failed', message: 'Sem conexão com a Casa Kaju agora.' });
    }
  }

  if (state.kind === 'sent') {
    return (
      <div role="status" className="mx-auto max-w-xl rounded-4xl bg-kaju-green p-8 text-center text-kaju-cream shadow-2xl sm:p-12">
        <h1 className="font-display text-3xl font-extrabold">Pedido enviado!</h1>
        <p className="mt-4 text-lg">
          Obrigada pela preferência{state.name ? `, ${state.name}` : ''}. Entraremos em contato pelo WhatsApp o mais breve possível.
        </p>
        <a href="/" className="btn btn-rose mt-8">
          Voltar para o início
        </a>
      </div>
    );
  }

  const presetDescription = preset.interest ? `Tenho interesse em: ${preset.interest}.\n` : '';

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={submit}
      aria-labelledby="orcamento-titulo"
      className="mx-auto flex max-w-xl flex-col gap-5 rounded-4xl bg-kaju-green p-6 shadow-2xl ring-1 ring-black/10 sm:p-9"
    >
      <div>
        <h1 id="orcamento-titulo" className="font-display text-3xl font-extrabold text-kaju-cream">
          Solicite um orçamento
        </h1>
        <p className="mt-2 text-sm text-kaju-cream/80">Respondemos pelo WhatsApp. Campos com * são obrigatórios.</p>
      </div>

      <div>
        <label htmlFor="name" className={label}>
          Nome *
        </label>
        <input id="name" name="name" autoComplete="name" maxLength={120} className={field} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-erro' : undefined} />
        {errors.name ? <p id="name-erro" className={errorText}>{errors.name}</p> : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className={label}>
            E-mail *
          </label>
          <input id="email" name="email" type="email" autoComplete="email" maxLength={200} className={field} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-erro' : undefined} />
          {errors.email ? <p id="email-erro" className={errorText}>{errors.email}</p> : null}
        </div>
        <div>
          <label htmlFor="phone" className={label}>
            WhatsApp *
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(41) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            className={field}
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'phone-erro' : undefined}
          />
          {errors.phone ? <p id="phone-erro" className={errorText}>{errors.phone}</p> : null}
        </div>
      </div>

      <fieldset aria-describedby={errors.segment ? 'segment-erro' : undefined}>
        <legend className={label}>Para qual segmento? *</legend>
        <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {SEGMENTS.map((s) => (
            <label key={s.key} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-kaju-cream">
              <input type="radio" name="segment" value={s.key} className="size-5 accent-kaju-rose" />
              {s.label}
            </label>
          ))}
        </div>
        {errors.segment ? <p id="segment-erro" className={errorText}>{errors.segment}</p> : null}
      </fieldset>

      <fieldset aria-describedby={errors.services ? 'services-erro' : undefined}>
        <legend className={label}>Qual serviço você precisa? *</legend>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {SERVICES.map((s) => (
            <label key={s.key} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-kaju-cream">
              <input
                type="checkbox"
                name="services"
                value={s.key}
                // Pré-seleção da URL: chave muda quando o efeito lê a URL, recriando o campo marcado.
                key={`${s.key}-${preset.service === s.key}`}
                defaultChecked={preset.service === s.key}
                className="size-5 rounded accent-kaju-rose"
              />
              {s.label}
            </label>
          ))}
        </div>
        {errors.services ? <p id="services-erro" className={errorText}>{errors.services}</p> : null}
      </fieldset>

      <div>
        <label htmlFor="description" className={label}>
          Conte-nos um pouco sobre o projeto *
        </label>
        <textarea
          id="description"
          name="description"
          rows={5}
          maxLength={4000}
          key={presetDescription}
          defaultValue={presetDescription}
          className={field}
          aria-invalid={!!errors.description}
          aria-describedby={`description-dica${errors.description ? ' description-erro' : ''}`}
        />
        <p id="description-dica" className="mt-1.5 text-xs leading-relaxed text-kaju-cream/80">
          Informações importantes: o que é / qual a estética desejada / quantidade / materiais desejados para confecção / será usado em ambiente interno ou externo /
          será manipulado ou usado em cena / precisa ser extra reforçado?
        </p>
        {errors.description ? <p id="description-erro" className={errorText}>{errors.description}</p> : null}
      </div>

      <div>
        <label htmlFor="neededBy" className={label}>
          Para quando é o projeto?
        </label>
        <input id="neededBy" name="neededBy" type="date" className={`${field} sm:w-56`} />
      </div>

      {/* Robôs preenchem; pessoas não veem. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Site</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {state.kind === 'failed' ? (
        <p role="alert" className="rounded-md bg-kaju-wine/30 p-3 text-sm text-kaju-cream">
          {state.message}{' '}
          <a className="font-bold underline" href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener">
            Fale com a gente no WhatsApp
          </a>
          .
        </p>
      ) : null}

      <button type="submit" className="btn btn-rose w-full text-base" disabled={state.kind === 'sending'} aria-busy={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Enviando…' : 'Enviar'}
      </button>
    </form>
  );
}
