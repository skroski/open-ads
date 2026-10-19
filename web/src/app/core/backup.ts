import { Injectable, inject } from '@angular/core';
import { AuditRules, BusinessConfig } from '../domain/models';
import { AccountStore } from './account.store';
import { BusinessConfigStore } from './business-config.store';
import { TrackingHistory } from './tracking-history';
import {
  ChangesStore,
  ContentStore,
  HypothesesStore,
  LeadsStore,
  LearningsStore,
  QuestionsStore,
  RecStatesStore,
} from './collections';

const FORMAT = 'gads-intel-backup';
const VERSION = 1;

export interface BackupFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  accountId: string;
  config: BusinessConfig;
  rules: AuditRules;
  leads: unknown[];
  content: unknown[];
  changes: unknown[];
  hypotheses: unknown[];
  learnings: unknown[];
  recStates: unknown[];
  questions?: unknown[];
  trackingHistory?: unknown[];
}

/**
 * Exporta e importa tudo o que fica salvo neste navegador (configurações, leads,
 * conteúdos, histórico, hipóteses, aprendizados). É a defesa contra perder o
 * aprendizado ao limpar os dados do navegador.
 */
@Injectable({ providedIn: 'root' })
export class Backup {
  private readonly account = inject(AccountStore);
  private readonly config = inject(BusinessConfigStore);
  private readonly leads = inject(LeadsStore);
  private readonly content = inject(ContentStore);
  private readonly changes = inject(ChangesStore);
  private readonly hypotheses = inject(HypothesesStore);
  private readonly learnings = inject(LearningsStore);
  private readonly recStates = inject(RecStatesStore);
  private readonly questions = inject(QuestionsStore);
  private readonly tracking = inject(TrackingHistory);

  build(): BackupFile {
    const { config, rules } = this.config.exportAll();
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      accountId: this.account.selectedId(),
      config,
      rules,
      leads: this.leads.items(),
      content: this.content.items(),
      changes: this.changes.items(),
      hypotheses: this.hypotheses.items(),
      learnings: this.learnings.items(),
      recStates: this.recStates.items(),
      questions: this.questions.items(),
      trackingHistory: this.tracking.exportAll(),
    };
  }

  download(): void {
    const file = this.build();
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inteligencia-${file.accountId || 'conta'}-${file.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Importa para a conta ativa. Devolve quantos registros entraram, por tipo. */
  async restore(text: string): Promise<Record<string, number>> {
    const data = JSON.parse(text) as Partial<BackupFile>;
    if (data.format !== FORMAT) throw new Error('Este arquivo não é um backup deste painel.');

    const accountId = this.account.selectedId();
    const retag = <T extends { id: string }>(rows: unknown[] | undefined): Array<T & { accountId: string }> =>
      (rows ?? [])
        .filter((r): r is T => !!r && typeof (r as { id?: unknown }).id === 'string')
        .map((r) => ({ ...r, accountId }));

    this.config.importAll({ config: data.config, rules: data.rules });

    const counts: Record<string, number> = {};
    const leads = retag<never>(data.leads);
    await this.leads.upsertMany(leads);
    counts['leads'] = leads.length;

    const content = retag<never>(data.content);
    await this.content.upsertMany(content);
    counts['conteúdos'] = content.length;

    const changes = retag<never>(data.changes);
    await this.changes.upsertMany(changes);
    counts['mudanças'] = changes.length;

    const hypotheses = retag<never>(data.hypotheses);
    await this.hypotheses.upsertMany(hypotheses);
    counts['hipóteses'] = hypotheses.length;

    const learnings = retag<never>(data.learnings);
    await this.learnings.upsertMany(learnings);
    counts['aprendizados'] = learnings.length;

    const recStates = (data.recStates ?? [])
      .filter((r): r is { id: string; status: never } => !!r && typeof (r as { id?: unknown }).id === 'string')
      .map((r) => {
        const recId = r.id.includes(':') ? r.id.split(':').slice(1).join(':') : r.id;
        return { ...(r as object), id: `${accountId}:${recId}`, accountId } as never;
      });
    await this.recStates.upsertMany(recStates);
    counts['status de ações'] = recStates.length;

    const questions = retag<never>(data.questions);
    await this.questions.upsertMany(questions);
    counts['dúvidas do atendimento'] = questions.length;

    counts['histórico de rastreamento'] = this.tracking.importAll(data.trackingHistory);

    return counts;
  }
}
