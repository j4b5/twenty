import { type SpenderType } from 'src/engine/core-modules/usage-limit/enums/spender-type.type';

export type SpeedBucketRequest = {
  key: string;
  burst: number;
  refillPerWindow: number;
  windowMs: number;
  spenderType: SpenderType;
  spenderId: string | null;
};
