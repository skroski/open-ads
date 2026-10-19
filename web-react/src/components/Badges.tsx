import type { ConfidenceLevel } from '@shared/domain/models';
import { CONFIDENCE_CLASS, CONFIDENCE_LABEL } from '@shared/shared/labels';

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return <span className={`${CONFIDENCE_CLASS[level]} whitespace-nowrap`}>{CONFIDENCE_LABEL[level]}</span>;
}
