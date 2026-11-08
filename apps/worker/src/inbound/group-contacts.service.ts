import { Inject, Injectable, Logger } from '@nestjs/common';
import type { InboundMessage } from '@coxia/contracts';
import { ContactService } from '@coxia/domain';
import { normalizePhone, type WhatsappProvider } from '@coxia/shared';
import { PrismaService, WHATSAPP_PROVIDER } from '../infra.module';

/** Lista de participantes do provedor vale por um dia; avisos de entrada/saída forçam nova leitura. */
export const GROUP_SYNC_TTL_MS = 24 * 60 * 60_000;

const JOINED = /^GROUP_PARTICIPANT_(ADD|INVITE|JOIN|ACCEPT)/;
const LEFT = /^GROUP_PARTICIPANT_(REMOVE|LEAVE|KICK)/;

type MessageForContacts = {
  organizationId: string;
  kind: string;
  fromMe: boolean;
  senderPhone: string | null;
  senderName: string | null;
  sentAt: Date;
  conversation: { instanceId: string; isGroup: boolean; group: { id: string; externalGroupId: string; contactsSyncedAt: Date | null } | null };
};

/**
 * Contatos a partir do WhatsApp: quem escreve, quem entra e quem sai dos grupos.
 * Nunca derruba o processamento da mensagem: falhas aqui só vão para o log
 * (a sincronização diária dos grupos corrige o que faltar).
 */
@Injectable()
export class GroupContactsService {
  private readonly logger = new Logger(GroupContactsService.name);
  private readonly contacts: ContactService;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsappProvider,
  ) {
    this.contacts = new ContactService(prisma);
  }

  async fromMessage(message: MessageForContacts, normalized: InboundMessage | null, now = new Date()) {
    try {
      const ownPhone = await this.ownPhone(message.conversation.instanceId, normalized?.connectedPhone ?? null);
      const group = message.conversation.isGroup ? message.conversation.group : null;
      const notification = message.kind === 'notification' ? normalized?.notification : null;

      if (notification && group) {
        const at = message.sentAt;
        if (JOINED.test(notification.type)) {
          await this.contacts.addToGroup(message.organizationId, group.id, notification.parameters.map((phone) => ({ phone })), at, ownPhone);
        } else if (LEFT.test(notification.type)) {
          await this.contacts.removeFromGroup(message.organizationId, group.id, notification.parameters, at);
        }
        // Entrou ou saiu alguém: relê a lista (traz os nomes e confirma o aviso).
        if (JOINED.test(notification.type) || LEFT.test(notification.type)) {
          await this.syncGroup(message.organizationId, group, ownPhone, now);
        }
        return;
      }

      if (!message.fromMe && message.kind !== 'notification') {
        await this.contacts.recordMessage(message.organizationId, {
          phone: message.senderPhone,
          whatsappName: message.senderName,
          groupId: group?.id ?? null,
          at: message.sentAt,
          ownPhone,
        });
      }
      if (group && (!group.contactsSyncedAt || now.getTime() - group.contactsSyncedAt.getTime() > GROUP_SYNC_TTL_MS)) {
        await this.syncGroup(message.organizationId, group, ownPhone, now);
      }
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, organization_id: message.organizationId }, 'contatos: falha ao registrar');
    }
  }

  /** Lê os participantes no provedor e sincroniza. Grupo sem participantes na resposta é ignorado (resposta suspeita). */
  async syncGroup(
    organizationId: string,
    group: { id: string; externalGroupId: string },
    ownPhone: string | null,
    now = new Date(),
  ): Promise<{ present: number; left: number } | null> {
    const info = await this.whatsapp.getGroupInfo(group.externalGroupId);
    if (info.participants.length === 0) {
      this.logger.warn({ group_id: group.id }, 'contatos: provedor devolveu grupo sem participantes; sincronização ignorada');
      return null;
    }
    return this.contacts.syncGroup(organizationId, group.id, info.participants, now, ownPhone);
  }

  /** Número da própria Coxia: o informado no webhook (e guardado na instância) ou o já salvo. */
  private async ownPhone(instanceId: string, connectedPhone: string | null): Promise<string | null> {
    const phone = normalizePhone(connectedPhone);
    if (phone) {
      await this.prisma.whatsappInstance.updateMany({
        where: { id: instanceId, OR: [{ phone: null }, { phone: { not: phone } }] },
        data: { phone },
      });
      return phone;
    }
    const inst = await this.prisma.whatsappInstance.findUnique({ where: { id: instanceId }, select: { phone: true } });
    return inst?.phone ?? null;
  }
}
