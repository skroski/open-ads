import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Evidence } from '../domain/models';
import { EpistemicBadge } from './badges';
import { SOURCE_LABEL } from './labels';

/** Lista de evidências com a natureza de cada uma (fato, hipótese ou indisponível). */
@Component({
  selector: 'app-evidence-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EpistemicBadge],
  template: `
    <ul class="flex flex-col gap-2">
      @for (e of items(); track $index) {
        <li class="flex items-start gap-2 text-sm leading-relaxed">
          <app-epistemic [kind]="e.kind" />
          <span class="min-w-0">
            {{ e.text }}
            <span class="text-base-content/70 text-xs">· {{ source(e.source) }}</span>
          </span>
        </li>
      } @empty {
        <li class="text-sm text-base-content/60">Sem evidências registradas.</li>
      }
    </ul>
  `,
})
export class EvidenceList {
  readonly items = input.required<readonly Evidence[]>();
  protected source = (s: Evidence['source']): string => SOURCE_LABEL[s];
}
