import { Controller, Get, Module } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class OrganizationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('organization')
  organization(@CurrentUser() user: AuthUser) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { id: true, name: true, slug: true, timezone: true, morningBriefingTime: true, projectGroupPrefix: true },
    });
  }

}

@Module({ controllers: [OrganizationController] })
export class OrganizationModule {}
