import { useMemo } from 'react';
import type { PageAudit } from '@shared/domain/models';
import { normalizeUrl } from '@shared/domain/text';
import { useAccount } from './account';

/** Mesmo cache e mesma validade (24 h) do PageAudits do Angular. */
const TTL_MS = 24 * 60 * 60 * 1000;
const key = (accountId: string): string => `gads_page_audits_${accountId || 'default'}`;

function load(accountId: string): Record<string, PageAudit> {
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PageAudit>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([, a]) => now - new Date(a.fetchedAt).getTime() < TTL_MS));
  } catch {
    return {};
  }
}

/** Leituras de página já feitas (somente leitura). Fazer novas leituras ainda é pelo painel Angular. */
export function usePageAudits(): { get(url: string): PageAudit | undefined } {
  const { selectedId } = useAccount();
  const audits = useMemo(() => load(selectedId), [selectedId]);
  return useMemo(() => ({ get: (url: string) => audits[normalizeUrl(url)] }), [audits]);
}
