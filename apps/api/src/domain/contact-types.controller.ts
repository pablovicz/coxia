import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ContactTypeService } from '@coxia/domain';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { contactTypeSchema, webActor } from './schemas';

const v = new ZodValidationPipe(contactTypeSchema);

/** Tipos de contato cadastrados pela equipe (Costureiras, Pintores…). Residente e Lead são automáticos. */
@Roles('owner', 'admin', 'staff')
@Controller('contact-types')
export class ContactTypesController {
  constructor(private readonly types: ContactTypeService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.types.list(user.organizationId);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v) body: z.infer<typeof contactTypeSchema>) {
    return this.types.create(user.organizationId, body.name, webActor(user));
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  rename(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v) body: z.infer<typeof contactTypeSchema>) {
    return this.types.rename(user.organizationId, id, body.name, webActor(user));
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.types.remove(user.organizationId, id, webActor(user));
  }
}
