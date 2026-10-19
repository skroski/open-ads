import { Injectable, effect, inject, linkedSignal, untracked } from '@angular/core';
import { diffTrackingSnapshots } from '../domain/tracking-health';
import type { TrackingChangeSet, TrackingSnapshot } from '../domain/tracking-health';
import { AccountStore } from './account.store';

export interface TrackingSnapshotRecord {
  at: string;
  workspacePath: string;
  snapshot: TrackingSnapshot;
}

const MAX_RECORDS_PER_WORKSPACE = 20;
const storageKey = (accountId: string): string => `gads_tracking_history_${accountId || 'default'}`;

function load(accountId: string): TrackingSnapshotRecord[] {
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is TrackingSnapshotRecord => !!item && typeof item === 'object' && typeof (item as TrackingSnapshotRecord).at === 'string' && typeof (item as TrackingSnapshotRecord).workspacePath === 'string' && !!(item as TrackingSnapshotRecord).snapshot)
      : [];
  } catch {
    return [];
  }
}

/** Histórico local e sanitizado do inventário: não armazena parâmetros ou credenciais de tags. */
@Injectable({ providedIn: 'root' })
export class TrackingHistory {
  private readonly account = inject(AccountStore);

  readonly records = linkedSignal<string, TrackingSnapshotRecord[]>({
    source: this.account.selectedId,
    computation: (accountId) => load(accountId),
  });

  constructor() {
    effect(() => {
      const records = this.records();
      const accountId = untracked(() => this.account.selectedId());
      try {
        localStorage.setItem(storageKey(accountId), JSON.stringify(records));
      } catch {
        /* histórico fica somente nesta sessão */
      }
    });
  }

  capture(snapshot: TrackingSnapshot): TrackingChangeSet | null {
    const previous = this.records().find((record) => record.workspacePath === snapshot.workspacePath);
    const change = previous ? diffTrackingSnapshots(previous.snapshot, snapshot) : null;
    if (previous && !change?.changed) return change;
    const next: TrackingSnapshotRecord = { at: new Date().toISOString(), workspacePath: snapshot.workspacePath, snapshot };
    this.records.update((records) => {
      const sameWorkspace = records.filter((record) => record.workspacePath === snapshot.workspacePath);
      const other = records.filter((record) => record.workspacePath !== snapshot.workspacePath);
      return [next, ...sameWorkspace.slice(0, MAX_RECORDS_PER_WORKSPACE - 1), ...other].slice(0, MAX_RECORDS_PER_WORKSPACE * 3);
    });
    return change;
  }

  latestChange(workspacePath: string): TrackingChangeSet | null {
    const [current, previous] = this.records().filter((record) => record.workspacePath === workspacePath);
    return current && previous ? diffTrackingSnapshots(previous.snapshot, current.snapshot) : null;
  }

  exportAll(): TrackingSnapshotRecord[] {
    return this.records();
  }

  importAll(records: unknown): number {
    if (!Array.isArray(records)) return 0;
    const valid = records.filter(
      (item): item is TrackingSnapshotRecord =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as TrackingSnapshotRecord).at === 'string' &&
        typeof (item as TrackingSnapshotRecord).workspacePath === 'string' &&
        Array.isArray((item as TrackingSnapshotRecord).snapshot?.tags),
    );
    this.records.set(valid.slice(0, MAX_RECORDS_PER_WORKSPACE * 3));
    return valid.length;
  }
}
