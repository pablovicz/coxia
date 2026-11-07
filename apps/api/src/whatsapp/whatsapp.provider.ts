import { FakeWhatsappProvider, type WhatsappProvider, ZapiProvider } from '@coxia/shared';
import type { ApiEnv } from '../config/env';

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

export function createWhatsappProvider(env: Pick<ApiEnv, 'WHATSAPP_PROVIDER' | 'ZAPI_BASE_URL' | 'ZAPI_INSTANCE_ID' | 'ZAPI_INSTANCE_TOKEN' | 'ZAPI_CLIENT_TOKEN'>): WhatsappProvider {
  if (env.WHATSAPP_PROVIDER === 'zapi') {
    return new ZapiProvider({
      baseUrl: env.ZAPI_BASE_URL,
      instanceId: env.ZAPI_INSTANCE_ID,
      instanceToken: env.ZAPI_INSTANCE_TOKEN,
      clientToken: env.ZAPI_CLIENT_TOKEN,
    });
  }
  return new FakeWhatsappProvider();
}
