import { type StepFilter, type StepFilterGroup } from 'twenty-shared/types';
import { resolveInput } from 'twenty-shared/utils';

import { resolveFilterValueAndOperand } from 'src/modules/workflow/workflow-executor/utils/resolve-filter-value-and-operand.util';

import { evaluateFilterConditions } from 'src/modules/workflow/workflow-executor/workflow-actions/filter/utils/evaluate-filter-conditions.util';

export const evaluateStepFilters = ({
  stepFilters,
  stepFilterGroups,
  context,
}: {
  stepFilters: StepFilter[];
  stepFilterGroups: StepFilterGroup[];
  context: Record<string, unknown>;
}): boolean => {
  const resolvedFilters = stepFilters.map((filter) => {
    const { value: rightOperand, operand } = resolveFilterValueAndOperand({
      value: filter.value,
      operand: filter.operand,
      context,
    });

    return {
      ...filter,
      operand,
      rightOperand,
      leftOperand: resolveInput(filter.stepOutputKey, context),
    };
  });

  return evaluateFilterConditions({
    filterGroups: stepFilterGroups,
    filters: resolvedFilters,
  });
};
