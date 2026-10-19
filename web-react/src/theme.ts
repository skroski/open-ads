import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Mesma chave do ThemeService do Angular: a escolha vale nas duas versões. */
export const THEME_STORAGE_KEY = 'gads_theme_pref';

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** "Sistema" remove `data-theme`: o daisyUI segue o modo do sistema operacional. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* armazenamento indisponível (navegação privada): vale só nesta sessão */
  }
}

export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(readStored);
  useEffect(() => applyTheme(preference), [preference]);
  const set = useCallback((next: ThemePreference) => setPreference(next), []);
  return [preference, set];
}

/** Tema efetivamente em uso (`light` ou `dark`), acompanhando `data-theme` e o modo do sistema. */
export function useResolvedTheme(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' => {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [resolved, setResolved] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const update = (): void => setResolved(read());
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media?.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);
  return resolved;
}
