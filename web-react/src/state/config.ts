import { useMemo } from 'react';
import { DEFAULT_AUDIT_RULES } from '@shared/domain/classify';
import { mergeConfig } from '@shared/domain/config';
import type { AuditRules, BusinessConfig } from '@shared/domain/models';
import { readJson } from '../lib/storage';
import { useAccount } from './account';

/** Mesmas chaves do BusinessConfigStore do Angular (metas, mapeamento do funil e regras, por conta). */
const configKey = (accountId: string): string => `gads_biz_config_${accountId || 'default'}`;
const rulesKey = (accountId: string): string => `gads_audit_config_${accountId || 'default'}`;

export function loadRules(accountId: string): AuditRules {
  const saved = readJson<Partial<AuditRules> | null>(rulesKey(accountId), null);
  if (!saved) return structuredClone(DEFAULT_AUDIT_RULES);
  return {
    brandTerms: saved.brandTerms ?? DEFAULT_AUDIT_RULES.brandTerms,
    unqualifiedTerms: saved.unqualifiedTerms ?? DEFAULT_AUDIT_RULES.unqualifiedTerms,
    qualifiedTerms: saved.qualifiedTerms ?? DEFAULT_AUDIT_RULES.qualifiedTerms,
    competitorTerms: saved.competitorTerms ?? DEFAULT_AUDIT_RULES.competitorTerms,
  };
}

export function loadConfig(accountId: string): BusinessConfig {
  return mergeConfig(readJson<Partial<BusinessConfig> | null>(configKey(accountId), null));
}

/** Configuração da conta ativa. Só leitura nesta etapa: a edição ainda é feita no painel Angular. */
export function useBusinessConfig(): { config: BusinessConfig; rules: AuditRules } {
  const { selectedId } = useAccount();
  return useMemo(() => ({ config: loadConfig(selectedId), rules: loadRules(selectedId) }), [selectedId]);
}
