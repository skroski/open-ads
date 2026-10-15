import { addDays } from './dates';
import { chanceOfZero } from './stats';
import { DailyRow } from './models';

/**
 * Falha de rastreamento por ausência estatisticamente improvável de conversões:
 * vários dias seguidos com cliques e nenhuma conversão, numa conta que normalmente
 * converte. Isso é indício de medição quebrada (tag, formulário, consentimento),
 * e não de campanha ruim.
 */

export interface OutageFinding {
  scope: 'ACCOUNT' | 'CAMPAIGN';
  campaignId?: string;
  campaignName?: string;
  from: string;
  to: string;
  days: number;
  clicks: number;
  cost: number;
  /** Taxa de conversão do restante do período (conversões por clique). */
  baselineRate: number;
  /** Chance de ver zero conversões nesses cliques só por acaso. */
  chanceByLuck: number;
  /** A sequência vai até o último dia com dados: pode estar acontecendo agora. */
  ongoing: boolean;
}

export interface OutageOptions {
  /** Chance máxima de acaso para acusar (padrão 1%: acusação de medição é forte). */
  alpha?: number;
  minClicks?: number;
  minDays?: number;
  /** Conversões mínimas no período para a taxa de referência valer. */
  minConversions?: number;
}

interface DayPoint {
  date: string;
  clicks: number;
  cost: number;
  conversions: number;
}

function collapse(rows: readonly DailyRow[]): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (const r of rows) {
    const p = map.get(r.date) ?? { date: r.date, clicks: 0, cost: 0, conversions: 0 };
    p.clicks += r.clicks;
    p.cost += r.cost;
    p.conversions += r.conversions;
    map.set(r.date, p);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function findRuns(
  points: DayPoint[],
  opts: Required<OutageOptions>,
  scope: OutageFinding['scope'],
  campaign?: { id: string; name: string },
): OutageFinding[] {
  const totalConv = points.reduce((s, p) => s + p.conversions, 0);
  const totalClicks = points.reduce((s, p) => s + p.clicks, 0);
  if (totalConv < opts.minConversions || totalClicks <= 0) return [];

  const lastDate = points.length ? points[points.length - 1].date : '';
  const out: OutageFinding[] = [];
  let run: DayPoint[] = [];

  const flush = (): void => {
    if (run.length >= opts.minDays) {
      const clicks = run.reduce((s, p) => s + p.clicks, 0);
      const cost = run.reduce((s, p) => s + p.cost, 0);
      const outsideClicks = totalClicks - clicks;
      if (clicks >= opts.minClicks && outsideClicks > 0) {
        const rate = totalConv / outsideClicks;
        const chance = chanceOfZero(rate, clicks);
        if (chance < opts.alpha) {
          out.push({
            scope,
            campaignId: campaign?.id,
            campaignName: campaign?.name,
            from: run[0].date,
            to: run[run.length - 1].date,
            days: run.length,
            clicks,
            cost,
            baselineRate: rate,
            chanceByLuck: chance,
            ongoing: run[run.length - 1].date === lastDate,
          });
        }
      }
    }
    run = [];
  };

  let previousDate = '';
  for (const p of points) {
    // Dia sem linha no relatório quebra a sequência (não é "zero conversões com cliques").
    const contiguous = previousDate === '' || addDays(previousDate, 1) === p.date;
    if (!contiguous) flush();
    if (p.conversions === 0) {
      run.push(p);
    } else {
      flush();
    }
    previousDate = p.date;
  }
  flush();
  return out;
}

export function detectConversionOutages(
  daily: readonly DailyRow[],
  options: OutageOptions = {},
): OutageFinding[] {
  const opts: Required<OutageOptions> = {
    alpha: options.alpha ?? 0.01,
    minClicks: options.minClicks ?? 20,
    minDays: options.minDays ?? 2,
    minConversions: options.minConversions ?? 8,
  };

  const findings = findRuns(collapse(daily), opts, 'ACCOUNT');

  const byCampaign = new Map<string, { name: string; rows: DailyRow[] }>();
  for (const r of daily) {
    const e = byCampaign.get(r.campaignId) ?? { name: r.campaignName, rows: [] };
    e.rows.push(r);
    byCampaign.set(r.campaignId, e);
  }
  for (const [id, e] of byCampaign) {
    findings.push(...findRuns(collapse(e.rows), opts, 'CAMPAIGN', { id, name: e.name }));
  }

  // Mais recente e mais grave primeiro.
  return findings.sort((a, b) => b.to.localeCompare(a.to) || a.chanceByLuck - b.chanceByLuck);
}
