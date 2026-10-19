import { useEffect, useMemo, useState } from 'react';
import type { ContentItem, Lead, RecommendationState, RecommendationStatus, SupportQuestion } from '@shared/domain/models';
import { listRecords, type DbRecord, type StoreName } from '../lib/localDb';
import { useAccount } from './account';

/** Coleção da conta ativa lida do armazenamento local (somente leitura). */
export function useCollection<T extends DbRecord>(store: StoreName): { items: T[]; loaded: boolean } {
  const { selectedId } = useAccount();
  const [state, setState] = useState<{ items: T[]; loaded: boolean }>({ items: [], loaded: false });

  useEffect(() => {
    let current = true;
    setState({ items: [], loaded: false });
    if (!selectedId) {
      setState({ items: [], loaded: true });
      return;
    }
    listRecords<T>(store, selectedId)
      .then((items) => current && setState({ items, loaded: true }))
      .catch(() => current && setState({ items: [], loaded: true }));
    return () => {
      current = false;
    };
  }, [store, selectedId]);

  return state;
}

export const useLeads = () => useCollection<Lead>('leads').items;
export const useContentItems = () => useCollection<ContentItem>('content').items;
export const useQuestions = () => useCollection<SupportQuestion>('questions').items;

/** Estado (aberta, feita, descartada…) e nota de cada recomendação, pela chave `contaId:recomendacaoId`. */
export function useRecommendationStates(): {
  statusOf(recId: string): RecommendationStatus;
  noteOf(recId: string): string | undefined;
} {
  const { items } = useCollection<RecommendationState>('recstates');
  return useMemo(() => {
    const byRec = new Map<string, RecommendationState>();
    for (const s of items) byRec.set(s.id.split(':').slice(1).join(':'), s);
    return {
      statusOf: (recId: string): RecommendationStatus => byRec.get(recId)?.status ?? 'OPEN',
      noteOf: (recId: string): string | undefined => byRec.get(recId)?.note,
    };
  }, [items]);
}
