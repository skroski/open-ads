import { Injectable, inject, linkedSignal } from '@angular/core';
import { DEFAULT_AUDIT_RULES } from '../domain/classify';
import { defaultBusinessConfig, mergeConfig } from '../domain/config';
import { AuditRules, BusinessConfig, BusinessContext, BusinessGoal, FunnelStage, ParamKey } from '../domain/models';
import { AccountStore } from './account.store';

const configKey = (accountId: string): string => `gads_biz_config_${accountId || 'default'}`;
/** Mantém a chave e o formato das versões anteriores, para não perder as listas já salvas. */
const rulesKey = (accountId: string): string => `gads_audit_config_${accountId || 'default'}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento: a alteração vale só nesta sessão */
  }
}

function loadRules(accountId: string): AuditRules {
  const saved = readJson<Partial<AuditRules>>(rulesKey(accountId));
  if (!saved) return structuredClone(DEFAULT_AUDIT_RULES);
  return {
    brandTerms: saved.brandTerms ?? DEFAULT_AUDIT_RULES.brandTerms,
    unqualifiedTerms: saved.unqualifiedTerms ?? DEFAULT_AUDIT_RULES.unqualifiedTerms,
    qualifiedTerms: saved.qualifiedTerms ?? DEFAULT_AUDIT_RULES.qualifiedTerms,
    competitorTerms: saved.competitorTerms ?? DEFAULT_AUDIT_RULES.competitorTerms,
  };
}

/** Metas, mapeamento do funil, área de atendimento e regras de auditoria — por conta. */
@Injectable({ providedIn: 'root' })
export class BusinessConfigStore {
  private readonly account = inject(AccountStore);

  readonly config = linkedSignal<string, BusinessConfig>({
    source: this.account.selectedId,
    computation: (id) => mergeConfig(readJson<Partial<BusinessConfig>>(configKey(id))),
  });

  readonly rules = linkedSignal<string, AuditRules>({
    source: this.account.selectedId,
    computation: (id) => loadRules(id),
  });

  /** `manual` marca como "informado por você" os parâmetros que a pessoa acabou de editar. */
  update(patch: Partial<BusinessConfig>, manual: readonly ParamKey[] = []): void {
    this.config.update((c) => {
      const paramStatus = { ...c.paramStatus, ...(patch.paramStatus ?? {}) };
      for (const key of manual) paramStatus[key] = 'MANUAL';
      const next = mergeConfig({ ...c, ...patch, paramStatus });
      writeJson(configKey(this.account.selectedId()), next);
      return next;
    });
  }

  updateGoal(patch: Partial<BusinessGoal>): void {
    const current = this.config().goal;
    const manual: ParamKey[] = [];
    if (patch.goalStage !== undefined && patch.goalStage !== current.goalStage) manual.push('goalStage');
    if (patch.targetCostPerGoal !== undefined && patch.targetCostPerGoal !== current.targetCostPerGoal) {
      manual.push('targetCostPerGoal');
    }
    this.update({ goal: { ...current, ...patch } }, manual);
  }

  setMapping(actionName: string, stage: FunnelStage | 'IGNORE'): void {
    this.update({ mapping: { ...this.config().mapping, [actionName]: stage } }, ['mapping']);
  }

  /** Etapa aceita a partir de uma sugestão: conta como confirmada, não como digitada. */
  confirmMapping(actionName: string, stage: FunnelStage): void {
    const c = this.config();
    this.update({
      mapping: { ...c.mapping, [actionName]: stage },
      paramStatus: { ...c.paramStatus, mapping: 'CONFIRMED' },
    });
  }

  /** Aplica uma configuração já calculada (ex.: sugestões aceitas). */
  replaceConfig(next: BusinessConfig): void {
    const merged = mergeConfig(next);
    this.config.set(merged);
    writeJson(configKey(this.account.selectedId()), merged);
  }

  saveContext(context: BusinessContext): void {
    this.update({ context });
  }

  saveRules(rules: AuditRules): void {
    this.rules.set(rules);
    writeJson(rulesKey(this.account.selectedId()), rules);
  }

  resetRules(): AuditRules {
    try {
      localStorage.removeItem(rulesKey(this.account.selectedId()));
    } catch {
      /* ignora */
    }
    const defaults = structuredClone(DEFAULT_AUDIT_RULES);
    this.rules.set(defaults);
    return defaults;
  }

  /** Para exportação/importação do backup. */
  exportAll(): { config: BusinessConfig; rules: AuditRules } {
    return { config: this.config(), rules: this.rules() };
  }

  importAll(data: { config?: Partial<BusinessConfig>; rules?: Partial<AuditRules> }): void {
    if (data.config) {
      const merged = mergeConfig(data.config);
      this.config.set(merged);
      writeJson(configKey(this.account.selectedId()), merged);
    }
    if (data.rules) {
      const merged: AuditRules = { ...structuredClone(DEFAULT_AUDIT_RULES), ...data.rules };
      this.saveRules(merged);
    }
  }

  reset(): void {
    const fresh = defaultBusinessConfig();
    this.config.set(fresh);
    writeJson(configKey(this.account.selectedId()), fresh);
  }
}
