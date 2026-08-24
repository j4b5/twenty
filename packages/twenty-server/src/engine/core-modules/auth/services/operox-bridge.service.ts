import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { type Repository } from 'typeorm';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export type OperoxProvisionWorkspaceResult = {
  workspaceId: string;
  subdomain: string;
};

export type OperoxGenerateLoginTokenResult = {
  loginToken: string;
  expiresAt: Date;
};

/**
 * OperoX Phase 109 QA spike bridge.
 *
 * Reached only through OperoxBridgeSecretGuard -- that guard, not this service, is the trust
 * boundary. Every method here delegates to the same services Twenty's own sign-up and
 * login-token flows use (SignInUpService, LoginTokenService, OnboardingService, WorkspaceService)
 * rather than hand-assembling workspace/user/member rows, so a provisioned workspace and a minted
 * session are indistinguishable from ones created through Twenty's normal UI (D-10, phase 109
 * must_haves).
 *
 * Constructed manually by AuthResolver rather than through Nest's own DI container -- see the
 * comment on AuthResolver.operoxBridgeService for why, and note the ModuleRef-based lookup of
 * WorkspaceService below, which exists for the same reason (avoiding a 6th core file just to
 * import WorkspaceModule into AuthModule).
 */
@Injectable()
export class OperoxBridgeService {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly signInUpService: SignInUpService,
    private readonly loginTokenService: LoginTokenService,
    private readonly onboardingService: OnboardingService,
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async provisionWorkspace({
    displayName,
    subdomain,
    ownerEmail,
  }: {
    organizationId: string;
    displayName: string;
    subdomain: string;
    ownerEmail: string;
  }): Promise<OperoxProvisionWorkspaceResult> {
    const derivedFirstName = ownerEmail.split('@')[0] || 'Owner';

    // Reuses the exact same new-workspace sign-up path Twenty's own signUpInNewWorkspace mutation
    // uses (SignInUpService.signUpOnNewWorkspace) -- this is what the "indistinguishable from a
    // normally-created workspace" must-have requires. Calling twice with the same subdomain does
    // NOT create a second workspace: the unique constraint on workspace.subdomain makes the
    // second call fail cleanly with WorkspaceException(SUBDOMAIN_ALREADY_TAKEN), which is left to
    // propagate rather than swallowed.
    const { user, workspace } = await this.signInUpService.signUpOnNewWorkspace(
      {
        type: 'newUserWithPicture',
        newUserWithPicture: {
          email: ownerEmail,
          firstName: derivedFirstName,
          lastName: '',
          picture: '',
          locale: 'en',
          isEmailVerified: true,
        },
      },
      { displayName, subdomain },
    );

    // Onboarding completion (F-109-01-A): a provisioned tenant owner embedded in the portal
    // iframe must never see Twenty's onboarding wizard. Each call below clears exactly the
    // pending flag activateOnboardingForUser set during signUpOnNewWorkspace, using the same
    // OnboardingService setters the real onboarding UI calls -- no parallel onboarding mechanism.
    await this.onboardingService.completeOnboardingProfileStepIfNameProvided({
      userId: user.id,
      workspaceId: workspace.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    await this.onboardingService.skipOnboardingConnectAccountStep({
      userId: user.id,
      workspaceId: workspace.id,
      isAutoSkipped: true,
    });
    await this.onboardingService.setOnboardingInstallAppsPending({
      userId: user.id,
      workspaceId: workspace.id,
      value: false,
    });
    await this.onboardingService.setOnboardingInviteTeamPending({
      workspaceId: workspace.id,
      value: false,
    });

    // WorkspaceService is not reachable via a static import here: WorkspaceModule is not part of
    // AuthModule's DI graph, and importing it there would be a 6th core file against the D-05
    // patch-file budget. A global, non-strict ModuleRef lookup resolves the exact same singleton
    // every other workspace-creation path in Twenty already depends on -- not a reimplementation.
    // Without this call the workspace stays PENDING_CREATION indefinitely (109-INFRA.md).
    const workspaceService = this.moduleRef.get(WorkspaceService, {
      strict: false,
    });

    await workspaceService.activateWorkspace(user, workspace);

    return { workspaceId: workspace.id, subdomain: workspace.subdomain };
  }

  async generateLoginToken({
    workspaceId,
    email,
  }: {
    workspaceId: string;
    email: string;
  }): Promise<OperoxGenerateLoginTokenResult> {
    const workspace = await this.workspaceRepository.findOneBy({
      id: workspaceId,
    });

    // Generic failure: a caller with a valid secret but a bad workspace id learns only that the
    // call failed, never that the id specifically does not exist.
    if (!workspace) {
      throw new AuthException(
        'Bridge request failed',
        AuthExceptionCode.INVALID_INPUT,
      );
    }

    const existingUser = await this.userRepository.findOneBy({ email });

    // Resolves or creates the user in the target workspace, mirroring the normal in-workspace
    // sign-up path (SignInUpService.signInUpOnExistingWorkspace) -- the same method Twenty's own
    // invitation-acceptance flow uses. addUserToWorkspaceIfUserNotInWorkspace is idempotent, so
    // calling this for a user who is already a member of the workspace is a safe no-op.
    if (existingUser) {
      await this.signInUpService.signInUpOnExistingWorkspace({
        workspace,
        userData: { type: 'existingUser', existingUser },
      });
    } else {
      await this.signInUpService.signInUpOnExistingWorkspace({
        workspace,
        userData: {
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email,
            firstName: email.split('@')[0] || 'Guest',
            lastName: '',
            picture: '',
            locale: 'en',
            isEmailVerified: true,
          },
        },
      });
    }

    // Mints the token through LoginTokenService.generateLoginToken -- the exact same call
    // AuthResolver.getLoginTokenFromCredentials makes for a real password login, with the same
    // AuthProviderEnum.Password provider tag. getAuthTokensFromLoginToken accepts this token
    // through its normal (non-impersonation) branch: no new token type, signing key or expiry
    // policy is introduced.
    return this.loginTokenService.generateLoginToken(
      email,
      workspace.id,
      AuthProviderEnum.Password,
    );
  }
}
