import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type UpsertUsageLimitInput } from 'src/engine/core-modules/usage-limit/dtos/upsert-usage-limit.input';
import {
  UsageLimitException,
  UsageLimitExceptionCode,
} from 'src/engine/core-modules/usage-limit/exceptions/usage-limit.exception';
import { UsageLimitEntity } from 'src/engine/core-modules/usage-limit/usage-limit.entity';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { findUsageLimitDefinition } from 'src/engine/core-modules/usage-limit/utils/find-usage-limit-definition.util';

@Injectable()
export class UsageLimitService {
  constructor(
    @InjectWorkspaceScopedRepository(UsageLimitEntity)
    private readonly usageLimitRepository: WorkspaceScopedRepository<UsageLimitEntity>,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async findAll(workspaceId: string): Promise<UsageLimitEntity[]> {
    return this.usageLimitRepository.find(workspaceId);
  }

  async upsert({
    workspaceId,
    input,
  }: {
    workspaceId: string;
    input: UpsertUsageLimitInput;
  }): Promise<UsageLimitEntity> {
    this.validateAgainstDefinition(input);

    await this.usageLimitRepository.upsert(
      workspaceId,
      {
        workspaceId,
        resourceType: input.resourceType,
        operationType: input.operationType,
        spenderType: input.spenderType,
        spenderId: input.spenderId ?? null,
        limitKind: input.limitKind,
        windowSeconds: input.windowSeconds,
        limitType: 'absolute',
        limitValue: input.limitValue,
        burstValue: input.burstValue ?? null,
      },
      {
        conflictPaths: [
          'workspaceId',
          'resourceType',
          'operationType',
          'spenderType',
          'spenderId',
          'limitKind',
          'windowSeconds',
        ],
      },
    );

    await this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
      'usageLimitRules',
    ]);

    const [usageLimit] = await this.usageLimitRepository.find(workspaceId, {
      where: {
        resourceType: input.resourceType,
        spenderType: input.spenderType,
        windowSeconds: input.windowSeconds,
      },
    });

    return usageLimit;
  }

  async delete({
    workspaceId,
    usageLimitId,
  }: {
    workspaceId: string;
    usageLimitId: string;
  }): Promise<boolean> {
    await this.usageLimitRepository.delete(workspaceId, { id: usageLimitId });

    await this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
      'usageLimitRules',
    ]);

    return true;
  }

  private validateAgainstDefinition(input: UpsertUsageLimitInput): void {
    const definition = findUsageLimitDefinition({
      resourceType: input.resourceType,
      limitKind: input.limitKind,
    });

    if (!isDefined(definition)) {
      throw new UsageLimitException(
        `No ${input.limitKind} limit is defined for ${input.resourceType}`,
        UsageLimitExceptionCode.LIMIT_RULE_INVALID,
      );
    }

    if (!definition.allowedSpenderTypes.includes(input.spenderType)) {
      throw new UsageLimitException(
        `${input.resourceType} ${input.limitKind} limits cannot be scoped to ${input.spenderType}`,
        UsageLimitExceptionCode.LIMIT_RULE_INVALID,
      );
    }

    if (input.limitKind === 'speed' && input.windowSeconds <= 0) {
      throw new UsageLimitException(
        'A speed limit needs a window longer than zero seconds',
        UsageLimitExceptionCode.LIMIT_RULE_INVALID,
      );
    }

    if (input.limitKind !== 'speed' && input.windowSeconds !== 0) {
      throw new UsageLimitException(
        `A ${input.limitKind} limit spans the billing period and cannot carry a window`,
        UsageLimitExceptionCode.LIMIT_RULE_INVALID,
      );
    }
  }
}
