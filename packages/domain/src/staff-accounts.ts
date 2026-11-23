import { randomBytes } from 'node:crypto';
import { audit, type Db, DomainError } from './common';
import { hashAuthToken, MIN_PASSWORD_LENGTH, type PasswordHasher } from './resident-accounts';
import { enqueueStaffEmail } from './staff-emails';

/** O link de redefinição vale 1 hora. */
export const STAFF_RESET_TTL_MS = 60 * 60 * 1000;

/** Redefinição de senha de quem é da equipe (login do painel Coxia). */
export class StaffPasswordService {
  constructor(
    private readonly db: Db,
    private readonly hasher: PasswordHasher,
  ) {}

  /** "Esqueci a senha": sempre responde igual, exista ou não o e-mail. */
  async requestReset(rawEmail: string, now = new Date()) {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email }, include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } } });
    const membership = user?.memberships[0];
    if (!user || !membership) return;
    // Um pedido por minuto basta: cliques repetidos não enchem a caixa de ninguém.
    const recent = await this.db.userAuthToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
    if (recent) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.$transaction(async (tx) => {
      const t = await tx.userAuthToken.create({ data: { userId: user.id, tokenHash: hashAuthToken(token), expiresAt: new Date(now.getTime() + STAFF_RESET_TTL_MS) } });
      await enqueueStaffEmail(tx, membership.organizationId, email, { template: 'staff_access', purpose: 'reset', userName: user.name, token }, `staff_password_reset:${t.id}`);
    });
  }

  /**
   * Define a senha nova pelo link. O link vale uma vez; os outros links pendentes deixam de valer
   * e quem estiver logado com a senha antiga precisa entrar de novo.
   */
  async setPassword(token: string, password: string, now = new Date()) {
    if (password.length < MIN_PASSWORD_LENGTH) throw new DomainError('validation', `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`, { code: 'weak_password' });
    if (password.length > 200) throw new DomainError('validation', 'Senha longa demais');
    const row = await this.db.userAuthToken.findUnique({ where: { tokenHash: hashAuthToken(token) }, include: { user: { include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } } } } });
    if (!row || row.usedAt || row.expiresAt <= now) throw new DomainError('validation', 'Este link expirou ou já foi usado. Peça um novo.', { code: 'invalid_token' });
    const passwordHash = await this.hasher.hash(password);
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.userAuthToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (!count) throw new DomainError('validation', 'Este link expirou ou já foi usado. Peça um novo.', { code: 'invalid_token' });
      await tx.userAuthToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, sessionsValidFrom: now } });
      const org = row.user.memberships[0]?.organizationId;
      if (org) await audit(tx, org, { channel: 'web', userId: row.userId }, 'user.password_reset', 'user', row.userId);
    });
    return { email: row.user.email };
  }
}
