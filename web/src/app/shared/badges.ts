import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ConfidenceLevel, Epistemic, Verdict } from '../domain/models';
import {
  CONFIDENCE_CLASS,
  CONFIDENCE_LABEL,
  EPISTEMIC_CLASS,
  EPISTEMIC_HELP,
  EPISTEMIC_LABEL,
  VERDICT_CLASS,
  VERDICT_LABEL,
} from './labels';

@Component({
  selector: 'app-verdict',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="cls()">{{ label() }}</span>`,
})
export class VerdictBadge {
  readonly verdict = input.required<Verdict>();
  protected cls = () => `${VERDICT_CLASS[this.verdict()]} whitespace-nowrap`;
  protected label = () => VERDICT_LABEL[this.verdict()];
}

@Component({
  selector: 'app-epistemic',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="cls()" [attr.title]="help()">{{ label() }}</span>`,
})
export class EpistemicBadge {
  readonly kind = input.required<Epistemic>();
  protected cls = () => `${EPISTEMIC_CLASS[this.kind()]} badge-sm shrink-0`;
  protected label = () => EPISTEMIC_LABEL[this.kind()];
  protected help = () => EPISTEMIC_HELP[this.kind()];
}

@Component({
  selector: 'app-confidence',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="cls()">{{ label() }}</span>`,
})
export class ConfidenceBadge {
  readonly level = input.required<ConfidenceLevel>();
  protected cls = () => `${CONFIDENCE_CLASS[this.level()]} whitespace-nowrap`;
  protected label = () => CONFIDENCE_LABEL[this.level()];
}
