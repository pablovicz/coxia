import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Post, Req, UnauthorizedException } from '@nestjs/common';
import { LoginThrottle } from './login-throttle';
import { StaffPasswordService } from '@coxia/domain';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService, type JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { API_ENV, type ApiEnv } from '../config/env';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthUser, CurrentUser, Public } from './decorators';
import { JwtAuthGuard, RolesGuard } from './guards';
import { ResidentAuthController } from './resident-auth.controller';

const loginSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});
type LoginInput = z.infer<typeof loginSchema>;
const forgotSchema = z.object({ email: z.string().email().transform((e) => e.toLowerCase()) });
const passwordSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) });

// Hash real com o mesmo custo, para igualar o tempo de resposta quando o e-mail não existe.
const DUMMY_HASH = bcrypt.hashSync('coxia-dummy-password', 12);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async login({ email, password }: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } } },
    });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    const membership = user?.memberships[0];
    if (!user || !ok || !membership) throw new UnauthorizedException('E-mail ou senha incorretos');

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      org: membership.organizationId,
      mid: membership.id,
      role: membership.role,
    });
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: membership.role },
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        timezone: membership.organization.timezone,
      },
    };
  }

  async me(auth: AuthUser) {
    const member = await this.prisma.organizationMember.findUniqueOrThrow({
      where: { id: auth.memberId },
      include: { user: true, organization: true },
    });
    return {
      user: {
        id: member.user.id,
        memberId: member.id,
        name: member.user.name,
        email: member.user.email,
        phone: member.user.phone,
        role: member.role,
        avatarUpdatedAt: member.user.avatarUpdatedAt,
      },
      organization: { id: member.organization.id, name: member.organization.name, timezone: member.organization.timezone },
      /** Recursos ligados nesta instalação (as telas escondem o que está desligado). */
      features: { checkIn: this.env.CHECK_IN_ENABLED },
    };
  }
}

@Controller('auth')
export class AuthController {
  private readonly throttle = new LoginThrottle();
  private readonly forgotThrottle = new LoginThrottle();

  constructor(
    private readonly auth: AuthService,
    private readonly passwords: StaffPasswordService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Req() req: { ip?: string }) {
    const ip = req.ip ?? 'unknown';
    this.throttle.check(ip, body.email);
    try {
      const result = await this.auth.login(body);
      this.throttle.succeed(ip, body.email);
      return result;
    } catch (err) {
      if (err instanceof UnauthorizedException) this.throttle.fail(ip, body.email);
      throw err;
    }
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** "Esqueci a senha": manda o link por e-mail. Sempre 204 (não revela se o e-mail existe). */
  @Public()
  @Post('forgot')
  @HttpCode(204)
  async forgot(@Body(new ZodValidationPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Req() req: { ip?: string }) {
    const ip = req.ip ?? 'unknown';
    this.forgotThrottle.check(ip, body.email);
    this.forgotThrottle.fail(ip, body.email);
    await this.passwords.requestReset(body.email);
  }

  /** Senha nova pelo link do e-mail (vale uma vez, por 1 hora). */
  @Public()
  @Post('password')
  @HttpCode(204)
  async password(@Body(new ZodValidationPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    await this.passwords.setPassword(body.token, body.password);
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => ({
        secret: env.JWT_SECRET,
        signOptions: { expiresIn: env.JWT_EXPIRES_IN as JwtSignOptions['expiresIn'], issuer: 'coxia' },
        verifyOptions: { issuer: 'coxia' },
      }),
    }),
  ],
  controllers: [AuthController, ResidentAuthController],
  providers: [
    AuthService,
    {
      provide: StaffPasswordService,
      inject: [PrismaService],
      useFactory: (db: PrismaService) => new StaffPasswordService(db, { hash: (p) => bcrypt.hash(p, 12), compare: (p, h) => bcrypt.compare(p, h) }),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
