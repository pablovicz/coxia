import { createHash, randomBytes } from 'node:crypto';
import {
  type Actor,
  audit,
  type Db,
  type DomainEventPublisher,
  DomainError,
  emit,
  getOrganization,
  NO_EVENTS,
} from './common';
import { enqueueResidentEmail } from './resident-emails';

/** Convite vale 7 dias; redefinição de senha, 1 hora. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

function assertPassword(password: string, label = 'A senha') {
  if (password.length < MIN_PASSWORD_LENGTH) throw new DomainError('validation', `${label} precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`, { code: 'weak_password' });
  if (password.length > 200) throw new DomainError('validation', 'Senha longa demais');
}

export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Acesso do residente ao workspace: convite por e-mail, definição e redefinição de senha. */
export class ResidentAccountService {
  constructor(
    private readonly db: Db,
    private readonly hasher: PasswordHasher,
    private readonly events: DomainEventPublisher = NO_EVENTS,
  ) {}

  async status(organizationId: string, residentId: string) {
    const account = await this.db.residentAccount.findFirst({
      where: { organizationId, residentId },
      select: { id: true, email: true, status: true, invitedAt: true, lastLoginAt: true, passwordHash: true, mustChangePassword: true },
    });
    if (!account) return null;
    const { passwordHash, ...rest } = account;
    return { ...rest, hasPassword: !!passwordHash };
  }

  /**
   * Envia (ou reenvia) o convite para o e-mail do cadastro do residente. Quem já tem senha
   * continua ativo; o link só serve para trocar a senha. Links anteriores deixam de valer.
   */
  async invite(organizationId: string, residentId: string, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const resident = await this.db.resident.findFirst({ where: { id: residentId, organizationId }, include: { account: true } });
    if (!resident) throw new DomainError('not_found', 'Residente não encontrado');
    if (resident.status === 'disabled') throw new DomainError('validation', 'Residente desabilitado não recebe acesso', { code: 'resident_disabled' });
    const email = resident.email?.trim().toLowerCase();
    if (!email || !EMAIL.test(email)) throw new DomainError('validation', 'Cadastre o e-mail do residente antes de enviar o convite', { code: 'email_required' });
    const taken = await this.db.residentAccount.findUnique({ where: { email } });
    if (taken && taken.residentId !== residentId) throw new DomainError('conflict', 'Este e-mail já é o acesso de outro residente', { code: 'email_taken' });

    const token = randomBytes(32).toString('base64url');
    const account = await this.db.$transaction(async (tx) => {
      const acc = resident.account
        ? await tx.residentAccount.update({
            where: { id: resident.account.id },
            data: { email, invitedAt: now, status: resident.account.passwordHash ? 'active' : 'invited' },
          })
        : await tx.residentAccount.create({ data: { organizationId, residentId, email, status: 'invited', invitedAt: now } });
      await tx.residentAuthToken.updateMany({ where: { accountId: acc.id, usedAt: null }, data: { usedAt: now } });
      const t = await tx.residentAuthToken.create({ data: { accountId: acc.id, purpose: 'invite', tokenHash: hashAuthToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS) } });
      await enqueueResidentEmail(tx, organizationId, email, { template: 'access', purpose: 'invite', residentName: resident.name, organizationName: org.name, token }, `resident_invite:${t.id}`);
      await audit(tx, organizationId, actor, 'resident.access_invite', 'resident', residentId, { after: { email } });
      return acc;
    });
    emit(this.events, { organizationId, type: 'access.changed', residentId });
    return this.status(organizationId, account.residentId);
  }

  /**
   * Senha provisória definida pela equipe (para passar ao residente pelo WhatsApp, por exemplo).
   * Ativa o acesso na hora; no primeiro login o workspace exige uma senha nova. Links de convite
   * pendentes deixam de valer e quem estiver logado precisa entrar de novo.
   */
  async setProvisionalPassword(organizationId: string, residentId: string, password: string, actor: Actor, now = new Date()) {
    assertPassword(password, 'A senha provisória');
    const resident = await this.db.resident.findFirst({ where: { id: residentId, organizationId }, include: { account: true } });
    if (!resident) throw new DomainError('not_found', 'Residente não encontrado');
    if (resident.status === 'disabled') throw new DomainError('validation', 'Residente desabilitado não recebe acesso', { code: 'resident_disabled' });
    const email = resident.email?.trim().toLowerCase();
    if (!email || !EMAIL.test(email)) throw new DomainError('validation', 'Cadastre o e-mail do residente: é o login do workspace', { code: 'email_required' });
    const taken = await this.db.residentAccount.findUnique({ where: { email } });
    if (taken && taken.residentId !== residentId) throw new DomainError('conflict', 'Este e-mail já é o acesso de outro residente', { code: 'email_taken' });
    const passwordHash = await this.hasher.hash(password);
    const data = { email, passwordHash, status: 'active' as const, mustChangePassword: true, sessionsValidFrom: now };
    await this.db.$transaction(async (tx) => {
      const acc = resident.account
        ? await tx.residentAccount.update({ where: { id: resident.account.id }, data })
        : await tx.residentAccount.create({ data: { organizationId, residentId, ...data } });
      await tx.residentAuthToken.updateMany({ where: { accountId: acc.id, usedAt: null }, data: { usedAt: now } });
      await audit(tx, organizationId, actor, 'resident.access_provisional_password', 'resident', residentId, { after: { email } });
    });
    emit(this.events, { organizationId, type: 'access.changed', residentId });
    return this.status(organizationId, residentId);
  }

  /** O próprio residente troca a senha (obrigatório depois de uma senha provisória). */
  async changePassword(accountId: string, currentPassword: string, newPassword: string, now = new Date()) {
    assertPassword(newPassword, 'A nova senha');
    const account = await this.db.residentAccount.findUnique({ where: { id: accountId } });
    if (!account?.passwordHash || account.status !== 'active') throw new DomainError('forbidden', 'Acesso desativado');
    if (!(await this.hasher.compare(currentPassword, account.passwordHash))) throw new DomainError('validation', 'A senha atual está incorreta', { code: 'wrong_password' });
    if (await this.hasher.compare(newPassword, account.passwordHash)) throw new DomainError('validation', 'Escolha uma senha diferente da atual', { code: 'same_password' });
    const passwordHash = await this.hasher.hash(newPassword);
    const updated = await this.db.$transaction(async (tx) => {
      const acc = await tx.residentAccount.update({ where: { id: accountId }, data: { passwordHash, mustChangePassword: false, sessionsValidFrom: now } });
      await audit(tx, acc.organizationId, { channel: 'resident', residentAccountId: acc.id }, 'resident.password_change', 'resident', acc.residentId);
      return acc;
    });
    emit(this.events, { organizationId: updated.organizationId, type: 'access.changed', residentId: updated.residentId });
    return updated;
  }

  async disable(organizationId: string, residentId: string, actor: Actor, now = new Date()) {
    const account = await this.db.residentAccount.findFirst({ where: { organizationId, residentId } });
    if (!account) throw new DomainError('not_found', 'Este residente não tem acesso');
    await this.db.$transaction(async (tx) => {
      await tx.residentAccount.update({ where: { id: account.id }, data: { status: 'disabled', sessionsValidFrom: now } });
      await tx.residentAuthToken.updateMany({ where: { accountId: account.id, usedAt: null }, data: { usedAt: now } });
      await audit(tx, organizationId, actor, 'resident.access_disable', 'resident', residentId);
    });
    emit(this.events, { organizationId, type: 'access.changed', residentId });
    return this.status(organizationId, residentId);
  }

  /** "Esqueci a senha": sempre responde igual, exista ou não o e-mail. */
  async requestReset(rawEmail: string, now = new Date()) {
    const email = rawEmail.trim().toLowerCase();
    const account = await this.db.residentAccount.findUnique({ where: { email }, include: { resident: true, organization: true } });
    if (!account || account.status === 'disabled' || account.resident.status === 'disabled') return;
    // Um pedido por minuto basta: evita encher a caixa de alguém com cliques repetidos.
    const recent = await this.db.residentAuthToken.findFirst({ where: { accountId: account.id, purpose: 'reset', createdAt: { gt: new Date(now.getTime() - 60_000) } } });
    if (recent) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.$transaction(async (tx) => {
      const t = await tx.residentAuthToken.create({ data: { accountId: account.id, purpose: 'reset', tokenHash: hashAuthToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS) } });
      await enqueueResidentEmail(
        tx,
        account.organizationId,
        account.email,
        { template: 'access', purpose: 'reset', residentName: account.resident.name, organizationName: account.organization.name, token },
        `password_reset:${t.id}`,
      );
    });
  }

  /** Define a senha pelo link do convite ou da redefinição. O link vale uma vez. */
  async setPassword(token: string, password: string, now = new Date()) {
    assertPassword(password);
    const row = await this.db.residentAuthToken.findUnique({ where: { tokenHash: hashAuthToken(token) }, include: { account: { include: { resident: true } } } });
    if (!row || row.usedAt || row.expiresAt <= now) throw new DomainError('validation', 'Este link expirou ou já foi usado. Peça um novo.', { code: 'invalid_token' });
    if (row.account.status === 'disabled' || row.account.resident.status === 'disabled') throw new DomainError('forbidden', 'Acesso desativado');
    const passwordHash = await this.hasher.hash(password);
    const account = await this.db.$transaction(async (tx) => {
      const { count } = await tx.residentAuthToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (!count) throw new DomainError('validation', 'Este link expirou ou já foi usado. Peça um novo.', { code: 'invalid_token' });
      await tx.residentAuthToken.updateMany({ where: { accountId: row.accountId, usedAt: null }, data: { usedAt: now } });
      const acc = await tx.residentAccount.update({ where: { id: row.accountId }, data: { passwordHash, status: 'active', mustChangePassword: false, sessionsValidFrom: now } });
      await audit(tx, acc.organizationId, { channel: 'resident', residentAccountId: acc.id }, `resident.password_${row.purpose === 'invite' ? 'set' : 'reset'}`, 'resident', acc.residentId);
      return acc;
    });
    emit(this.events, { organizationId: account.organizationId, type: 'access.changed', residentId: account.residentId });
    return account;
  }

  /** Conta para o login (a api confere o hash). Nunca devolve contas desativadas como válidas. */
  async findForLogin(rawEmail: string) {
    const account = await this.db.residentAccount.findUnique({ where: { email: rawEmail.trim().toLowerCase() }, include: { resident: true, organization: true } });
    if (!account || account.status !== 'active' || account.resident.status !== 'active' || !account.passwordHash) return { account: null, hash: null };
    return { account, hash: account.passwordHash };
  }

  async touchLogin(accountId: string, now = new Date()) {
    await this.db.residentAccount.update({ where: { id: accountId }, data: { lastLoginAt: now } });
  }
}
