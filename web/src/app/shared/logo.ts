import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { BRAND } from '../brand';
import { ThemeService } from '../core/theme.service';

export type LogoVariant = 'expanded' | 'symbol';
export type LogoTone = 'auto' | 'dark' | 'light';

/**
 * Componente oficial de exibição da marca OpenAds.
 *
 * Suporta:
 * - `variant`: 'expanded' (logo completo) ou 'symbol' (somente o símbolo)
 * - `tone`:
 *    - 'dark': versão Dark (detalhes escuros), indicada para fundo claro.
 *    - 'light': versão Light (detalhes claros), indicada para fundo escuro.
 *    - 'auto': acompanha o tema ativo do ThemeService (claro → Dark, escuro → Light).
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center justify-center' },
  template: `
    <img
      [src]="src()"
      [alt]="alt()"
      [attr.width]="isSymbol() ? 168 : 619"
      [attr.height]="168"
      [class]="imgClass()"
      loading="eager"
      decoding="async"
    />
  `,
})
export class Logo {
  private readonly theme = inject(ThemeService);

  readonly variant = input<LogoVariant>('expanded');
  readonly tone = input<LogoTone>('auto');
  readonly alt = input('OpenAds');
  readonly customClass = input<string>('');

  protected readonly isSymbol = computed(() => this.variant() === 'symbol');

  protected readonly resolvedTone = computed<'dark' | 'light'>(() => {
    const t = this.tone();
    if (t !== 'auto') return t;
    // Fundo escuro no tema dark -> logo Light
    // Fundo claro no tema light -> logo Dark
    return this.theme.resolved() === 'dark' ? 'light' : 'dark';
  });

  protected readonly src = computed(() => {
    const symbol = this.isSymbol();
    const dark = this.resolvedTone() === 'dark';
    if (symbol) {
      return dark ? BRAND.logos.symbolDark : BRAND.logos.symbolLight;
    }
    return dark ? BRAND.logos.expandedDark : BRAND.logos.expandedLight;
  });

  protected readonly imgClass = computed(() => {
    const extra = this.customClass();
    if (extra) return extra;
    return this.isSymbol()
      ? 'size-9 object-contain select-none'
      : 'h-8 w-auto max-w-[170px] object-contain select-none';
  });
}
