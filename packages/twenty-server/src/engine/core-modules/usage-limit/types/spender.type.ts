import { type SpenderType } from 'src/engine/core-modules/usage-limit/enums/spender-type.type';

export type Spender = {
  spenderType: SpenderType;
  spenderId: string | null;
};
