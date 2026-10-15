import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeService } from '../core/theme.service';
import { Icon } from './icon';

/** Alterna entre claro e escuro. Até o primeiro clique, segue o sistema operacional. */
@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <button type="button" class="btn btn-square border-base-300 bg-base-100" [attr.aria-label]="label()" [attr.title]="label()" (click)="toggle()">
      <app-icon [name]="dark() ? 'sun' : 'moon'" size="sm" />
    </button>
  `,
})
export class ThemeToggle {
  private readonly theme = inject(ThemeService);
  protected readonly dark = computed(() => this.theme.resolved() === 'dark');
  protected readonly label = computed(() => (this.dark() ? 'Usar tema claro' : 'Usar tema escuro'));

  protected toggle(): void {
    this.theme.set(this.dark() ? 'light' : 'dark');
  }
}
