import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ResidentAccountService } from '@coxia/domain';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from './decorators';
import type { ResidentPayload } from './guards';
import { LoginThrottle } from './login-throttle';

const loginSchema = z.object({ email: z.string().email().transform((e) => e.toLowerCase()), password: z.string().min(1).max(200) });
const forgotSchema = z.object({ email: z.string().email().transform((e) => e.toLowerCase()) });
const passwordSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) });

// Mesmo custo do hash real: e-mail inexistente responde no mesmo tempo.
const DUMMY_HASH = bcrypt.hashSync('coxia-resident-dummy', 12);

/** O residente fica logado no celular (escaneia o QR da sala): sessão de 30 dias. */
const RESIDENT_SESSION = '30d';

/** Login do workspace do residente (residente.casakaju.com). Separado do login da equipe. */
@Controller('resident-auth')
export class ResidentAuthController {
  private readonly throttle = new LoginThrottle();
  private readonly forgotThrottle = new LoginThrottle();

  constructor(
    private readonly accounts: ResidentAccountService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: { ip?: string }) {
    const ip = req.ip ?? 'unknown';
    this.throttle.check(ip, body.email);
    const { account, hash } = await this.accounts.findForLogin(body.email);
    const ok = await bcrypt.compare(body.password, hash ?? DUMMY_HASH);
    if (!account || !ok) {
      this.throttle.fail(ip, body.email);
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }
    this.throttle.succeed(ip, body.email);
    await this.accounts.touchLogin(account.id);
    const payload: ResidentPayload = { sub: account.id, org: account.organizationId, res: account.residentId, kind: 'resident' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: RESIDENT_SESSION });
    return {
      accessToken,
      resident: { id: account.residentId, name: account.resident.name, email: account.email },
      organization: { id: account.organization.id, name: account.organization.name, timezone: account.organization.timezone },
    };
  }

  /** Sempre 204: não revela se o e-mail tem acesso. */
  @Public()
  @Post('forgot')
  @HttpCode(204)
  async forgot(@Body(new ZodValidationPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Req() req: { ip?: string }) {
    const ip = req.ip ?? 'unknown';
    this.forgotThrottle.check(ip, body.email);
    this.forgotThrottle.fail(ip, body.email);
    await this.accounts.requestReset(body.email);
  }

  /** Define a senha pelo link do e-mail (convite ou redefinição). */
  @Public()
  @Post('password')
  @HttpCode(204)
  async password(@Body(new ZodValidationPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    await this.accounts.setPassword(body.token, body.password);
  }
}
