import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'gads_theme_pref';

/**
 * Tema claro/escuro usando os temas oficiais `light` e `dark` do daisyUI.
 *
 * - "Claro" e "Escuro" gravam `data-theme` no <html>.
 * - "Sistema" remove o atributo: o daisyUI usa `light` por padrão e `dark` quando o
 *   sistema operacional pede (`--prefersdark`), e acompanha a mudança em tempo real.
 *
 * O script inline do index.html aplica a preferência antes do Angular iniciar,
 * evitando o "flash" do tema errado.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly media = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

  readonly preference = signal<ThemePreference>(this.readStored());
  private readonly systemDark = signal<boolean>(this.media?.matches ?? false);

  /** Tema efetivamente em uso, útil para quem precisa saber (gráficos, ícones). */
  readonly resolved = computed<'light' | 'dark'>(() => {
    const pref = this.preference();
    if (pref === 'system') return this.systemDark() ? 'dark' : 'light';
    return pref;
  });

  constructor() {
    const onChange = (event: MediaQueryListEvent): void => this.systemDark.set(event.matches);
    this.media?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', onChange));

    effect(() => this.apply(this.preference()));
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
  }

  private apply(preference: ThemePreference): void {
    const root = this.doc.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* armazenamento indisponível (navegação privada): a escolha vale só nesta sessão */
    }
  }

  private readStored(): ThemePreference {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
      return 'system';
    }
  }
}
