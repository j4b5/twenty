import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('EffectiveUsageLimit')
export class EffectiveUsageLimitDTO {
  @Field()
  resourceType: string;

  @Field()
  displayName: string;

  @Field()
  spenderType: string;

  @Field(() => String, { nullable: true })
  spenderId: string | null;

  @Field()
  windowSeconds: number;

  @Field()
  defaultValue: number;

  @Field(() => Number, { nullable: true })
  appliedValue: number | null;

  @Field()
  effectiveValue: number;
}
