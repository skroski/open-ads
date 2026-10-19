import { STAGE_HELP, STAGE_LABEL, type FunnelStage } from '@shared/domain/models';
import type { StageSource } from '@shared/domain/funnel';
import { decimal, percent } from '../lib/format';

export interface FunnelBar {
  stage: FunnelStage;
  count: number;
  source: StageSource;
}

const SOURCE_LABEL: Record<StageSource, string> = {
  ADS: 'Google Ads',
  CRM: 'CRM',
  NONE: 'indisponível',
};

/**
 * Funil como barras horizontais: uma série só, uma cor, valor na ponta.
 * Estágio sem fonte de dados aparece como "indisponível" (nunca como zero).
 */
export function FunnelBars({ bars }: { bars: readonly FunnelBar[] }) {
  const max = Math.max(1, ...bars.filter((b) => b.source !== 'NONE').map((b) => b.count));
  let previous: number | null = null;
  const rows = bars.map((b) => {
    const available = b.source !== 'NONE';
    const fromPrevious = available && previous !== null && previous > 0 ? b.count / previous : null;
    if (available) previous = b.count;
    return { ...b, available, fromPrevious, width: available ? (b.count / max) * 100 : 0 };
  });

  return (
    <ol className="flex flex-col gap-3" aria-label="Funil de qualidade">
      {rows.map((r) => (
        <li key={r.stage}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-medium" title={STAGE_HELP[r.stage]}>
                {STAGE_LABEL[r.stage]}
              </span>
              <span className="ml-2 text-xs text-base-content/60">{SOURCE_LABEL[r.source]}</span>
            </div>
            <div className="shrink-0 text-right text-sm tabular">
              {r.available ? (
                <>
                  <span className="font-semibold">{decimal(r.count, 0, 1)}</span>
                  {r.fromPrevious !== null && (
                    <span className="ml-1.5 text-xs text-base-content/60">{percent(r.fromPrevious, 1, 1)} do anterior</span>
                  )}
                </>
              ) : (
                <span className="text-base-content/50">—</span>
              )}
            </div>
          </div>
          <div
            className="mt-1 h-2.5 rounded-full bg-base-200"
            role="img"
            aria-label={r.available ? `${STAGE_LABEL[r.stage]}: ${r.count} (${SOURCE_LABEL[r.source]})` : `${STAGE_LABEL[r.stage]}: indisponível, sem fonte de dados`}
          >
            {r.available && <div className="h-full rounded-full bg-primary" style={{ width: `${r.width}%`, minWidth: r.count > 0 ? 6 : 0 }}></div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
