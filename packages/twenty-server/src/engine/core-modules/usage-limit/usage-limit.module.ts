import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsageLimitSpeedService } from 'src/engine/core-modules/usage-limit/services/usage-limit-speed.service';
import { UsageLimitResolver } from 'src/engine/core-modules/usage-limit/usage-limit.resolver';
import { UsageLimitService } from 'src/engine/core-modules/usage-limit/services/usage-limit.service';
import { UsageLimitRulesCacheService } from 'src/engine/core-modules/usage-limit/services/usage-limit-rules-cache.service';
import { UsageLimitEntity } from 'src/engine/core-modules/usage-limit/usage-limit.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UsageLimitEntity]),
    WorkspaceCacheModule,
    PermissionsModule,
  ],
  providers: [
    UsageLimitSpeedService,
    UsageLimitRulesCacheService,
    UsageLimitService,
    UsageLimitResolver,
    provideWorkspaceScopedRepository(UsageLimitEntity),
  ],
  exports: [UsageLimitSpeedService, UsageLimitRulesCacheService, TypeOrmModule],
})
export class UsageLimitModule {}
