import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { ResidentPayload } from './guards';

/** Prazo fixo da sessão, contado do login: renovar não estende. */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Fim da sessão (login + 7 dias): depois disso, entrar de novo. */
  refreshExpiresAt: string;
}

type SessionOwner = { kind: 'staff'; userId: string; memberId: string } | { kind: 'resident'; residentAccountId: string };

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

function sameHash(a: string, b: string | null): boolean {
  if (!b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** "<id da sessão>.<segredo>": o id acha a linha; só o hash do segredo fica no banco. */
function newSecret(sessionId: string) {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${sessionId}.${secret}`, hash: hash(secret) };
}

function parse(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}

/**
 * Sessões com refresh token (equipe e residente). O access token (JWT) é curto; o refresh token
 * troca a cada uso, e a sessão acaba 7 dias depois do login, use ou não.
 */
@Injectable()
export class AuthSessionService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Abre a sessão no login (ou depois de trocar a senha). */
  async start(owner: SessionOwner, accessPayload: object): Promise<TokenPair> {
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const id = randomUUID();
    const next = newSecret(id);
    await this.db.authSession.create({
      data: {
        id,
        kind: owner.kind,
        ...(owner.kind === 'staff' ? { userId: owner.userId, memberId: owner.memberId } : { residentAccountId: owner.residentAccountId }),
        tokenHash: next.hash,
        expiresAt,
      },
    });
    return { accessToken: await this.jwt.signAsync(accessPayload), refreshToken: next.token, refreshExpiresAt: expiresAt.toISOString() };
  }

  /**
   * Troca o refresh token por um par novo. Token antigo reapresentado (cópia vazada ou reenvio)
   * revoga a sessão inteira. Senha redefinida, membro removido ou acesso desativado: 401.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const parsed = parse(refreshToken);
    if (!parsed) throw new UnauthorizedException();
    const session = await this.db.authSession.findUnique({ where: { id: parsed.id } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();

    const presented = hash(parsed.secret);
    if (!sameHash(presented, session.tokenHash)) {
      if (sameHash(presented, session.previousTokenHash)) await this.revokeById(session.id);
      throw new UnauthorizedException();
    }

    const payload = await this.accessPayload(session);
    if (!payload) {
      await this.revokeById(session.id);
      throw new UnauthorizedException();
    }

    const next = newSecret(session.id);
    // Condicional no hash atual: duas renovações simultâneas com o mesmo token, só uma vence.
    const { count } = await this.db.authSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
      data: { tokenHash: next.hash, previousTokenHash: session.tokenHash, lastUsedAt: new Date() },
    });
    if (count !== 1) throw new UnauthorizedException();
    return { accessToken: await this.jwt.signAsync(payload), refreshToken: next.token, refreshExpiresAt: session.expiresAt.toISOString() };
  }

  /** Logout: revoga a sessão do refresh token (token inválido é ignorado). */
  async revoke(refreshToken: string): Promise<void> {
    const parsed = parse(refreshToken);
    if (!parsed) return;
    const session = await this.db.authSession.findUnique({ where: { id: parsed.id }, select: { id: true, tokenHash: true, previousTokenHash: true } });
    if (!session) return;
    const presented = hash(parsed.secret);
    if (sameHash(presented, session.tokenHash) || sameHash(presented, session.previousTokenHash)) await this.revokeById(session.id);
  }

  private async revokeById(id: string) {
    await this.db.authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Relê do banco quem é o dono da sessão: o papel e o acesso valem como estão agora. */
  private async accessPayload(session: {
    kind: 'staff' | 'resident';
    memberId: string | null;
    userId: string | null;
    residentAccountId: string | null;
    createdAt: Date;
  }): Promise<object | null> {
    if (session.kind === 'staff') {
      if (!session.memberId) return null;
      const member = await this.db.organizationMember.findUnique({
        where: { id: session.memberId },
        select: { id: true, role: true, userId: true, organizationId: true, user: { select: { sessionsValidFrom: true } } },
      });
      if (!member || member.userId !== session.userId) return null;
      // Senha redefinida depois do login: esta sessão não vale mais.
      if (member.user.sessionsValidFrom && session.createdAt < member.user.sessionsValidFrom) return null;
      return { sub: member.userId, org: member.organizationId, mid: member.id, role: member.role };
    }
    if (!session.residentAccountId) return null;
    const account = await this.db.residentAccount.findUnique({
      where: { id: session.residentAccountId },
      select: { id: true, status: true, residentId: true, organizationId: true, sessionsValidFrom: true, resident: { select: { status: true } } },
    });
    if (!account || account.status !== 'active' || account.resident.status !== 'active') return null;
    if (account.sessionsValidFrom && session.createdAt < account.sessionsValidFrom) return null;
    return { sub: account.id, org: account.organizationId, res: account.residentId, kind: 'resident' } satisfies ResidentPayload;
  }
}
