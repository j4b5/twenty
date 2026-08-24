import { Test, type TestingModule } from '@nestjs/testing';

import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { UsageResourceType } from 'src/engine/core-modules/usage/enums/usage-resource-type.enum';
import { type UpsertUsageLimitInput } from 'src/engine/core-modules/usage-limit/dtos/upsert-usage-limit.input';
import { UsageLimitExceptionCode } from 'src/engine/core-modules/usage-limit/exceptions/usage-limit.exception';
import { UsageLimitService } from 'src/engine/core-modules/usage-limit/services/usage-limit.service';
import { UsageLimitEntity } from 'src/engine/core-modules/usage-limit/usage-limit.entity';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/twenty-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_ID = 'workspace-1';

const validSpeedRule: UpsertUsageLimitInput = {
  resourceType: UsageResourceType.API,
  operationType: UsageOperationType.API_REQUEST,
  spenderType: 'apiKey',
  spenderId: 'key-1',
  limitKind: 'speed',
  windowSeconds: 60,
  limitValue: 100,
};

describe('UsageLimitService', () => {
  let service: UsageLimitService;
  const repository = {
    find: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const workspaceCacheService = {
    invalidateAndRecompute: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageLimitService,
        {
          provide: getWorkspaceScopedRepositoryToken(UsageLimitEntity),
          useValue: repository,
        },
        { provide: WorkspaceCacheService, useValue: workspaceCacheService },
      ],
    }).compile();

    service = module.get<UsageLimitService>(UsageLimitService);
  });

  it('rejects a resource that has no definition', async () => {
    await expect(
      service.upsert({
        workspaceId: WORKSPACE_ID,
        input: { ...validSpeedRule, resourceType: UsageResourceType.STORAGE },
      }),
    ).rejects.toMatchObject({
      code: UsageLimitExceptionCode.LIMIT_RULE_INVALID,
    });

    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('refuses to rate-limit a human, because the definition does not allow that scope', async () => {
    await expect(
      service.upsert({
        workspaceId: WORKSPACE_ID,
        input: { ...validSpeedRule, spenderType: 'userWorkspace' },
      }),
    ).rejects.toMatchObject({
      code: UsageLimitExceptionCode.LIMIT_RULE_INVALID,
    });
  });

  it('rejects a speed rule with no window', async () => {
    await expect(
      service.upsert({
        workspaceId: WORKSPACE_ID,
        input: { ...validSpeedRule, windowSeconds: 0 },
      }),
    ).rejects.toMatchObject({
      code: UsageLimitExceptionCode.LIMIT_RULE_INVALID,
    });
  });

  it('saves a valid rule and invalidates the cached rule set', async () => {
    await service.upsert({ workspaceId: WORKSPACE_ID, input: validSpeedRule });

    expect(repository.upsert).toHaveBeenCalled();
    expect(workspaceCacheService.invalidateAndRecompute).toHaveBeenCalledWith(
      WORKSPACE_ID,
      ['usageLimitRules'],
    );
  });
});
