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

  @Get('spaces')
  spaces(@CurrentUser() user: AuthUser) {
    return this.prisma.space.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        aliases: true,
        capacity: true,
        availabilityRules: { select: { weekday: true, opensAt: true, closesAt: true }, orderBy: { weekday: 'asc' } },
      },
    });
  }
}

@Module({ controllers: [OrganizationController] })
export class OrganizationModule {}
