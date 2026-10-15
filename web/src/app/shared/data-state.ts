import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from './icon';

/**
 * Casca para qualquer bloco que depende de dados carregados: mostra esqueleto
 * enquanto carrega, o erro com "tentar novamente", ou o conteúdo.
 */
@Component({
  selector: 'app-data-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (error(); as message) {
      <div role="alert" class="alert alert-error alert-soft">
        <app-icon name="warning" />
        <div class="min-w-0">
          <h3 class="font-semibold">{{ title() }}</h3>
          <div class="text-sm break-words">{{ message }}</div>
        </div>
        <button type="button" class="btn btn-sm" (click)="retry.emit()">Tentar novamente</button>
      </div>
    } @else if (loading() && !hasData()) {
      <div class="flex flex-col gap-block" aria-busy="true" aria-label="Carregando">
        <div class="skeleton h-24 w-full"></div>
        <div class="skeleton h-64 w-full"></div>
      </div>
    } @else {
      <div class="flex flex-col gap-block">
        <ng-content />
      </div>
    }
  `,
})
export class DataState {
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly hasData = input(false);
  readonly title = input('Não foi possível carregar os dados');
  readonly retry = output<void>();
}
