import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { createHash, timingSafeEqual } from 'node:crypto';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { getRequest } from 'src/utils/extract-request';

/**
 * OperoX Phase 109 QA spike guard.
 *
 * Guards operoxProvisionWorkspace and operoxGenerateLoginToken (auth.resolver.ts). This guard,
 * not the resolver method body, is the trust boundary: NestJS runs canActivate() before the
 * decorated method executes, so a denial here happens before any database read or write.
 *
 * Denial for a missing header and denial for a wrong header value are made indistinguishable on
 * purpose -- both paths simply return false, which Nest turns into the same stock
 * ForbiddenException, and neither path logs the supplied header value. A caller must not be able
 * to use response or timing differences as an oracle for which secret is configured.
 */
@Injectable()
export class OperoxBridgeSecretGuard implements CanActivate {
  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredSecret = this.twentyConfigService.get(
      'OPEROX_BRIDGE_SECRET',
    );

    // A fork deployed without the secret configured must expose no bridge at all, not an open
    // one -- deny unconditionally rather than falling back to "no check".
    if (typeof configuredSecret !== 'string' || configuredSecret.length === 0) {
      return false;
    }

    const request = getRequest(context);
    const providedSecret = request?.headers?.['x-operox-bridge-secret'];

    if (typeof providedSecret !== 'string' || providedSecret.length === 0) {
      return false;
    }

    // Constant-time comparison: both values are hashed to a fixed-length (32-byte) digest first,
    // so timingSafeEqual's equal-length precondition always holds and a wrong secret costs
    // exactly as many comparison cycles as a missing one, regardless of how many leading bytes of
    // the real secret happen to match.
    const configuredDigest = createHash('sha256').update(configuredSecret).digest();
    const providedDigest = createHash('sha256').update(providedSecret).digest();

    return timingSafeEqual(configuredDigest, providedDigest);
  }
}
