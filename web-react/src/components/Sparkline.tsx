const W = 112;
const H = 32;

/**
 * Linha de tendência de 2px, área a 10%, ponto final de 8px com anel da cor do fundo.
 * Cor herdada do texto (currentColor), então funciona nos dois temas.
 */
export function Sparkline({ values, label = 'Tendência no período' }: { values: readonly number[]; label?: string }) {
  let path: { line: string; area: string; x: number; y: number } | null = null;
  if (values.length >= 2) {
    const pad = 5;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = (W - pad * 2) / (values.length - 1);
    const pts = values.map((val, i) => [pad + i * step, H - pad - ((val - min) / span) * (H - pad * 2)] as const);
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    path = { line, area: `${line} L${last[0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`, x: last[0], y: last[1] };
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-28 overflow-visible" role="img" aria-label={label}>
      {path && (
        <>
          <path d={path.area} fill="currentColor" fillOpacity={0.1} />
          <path d={path.line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={path.x} cy={path.y} r={4} fill="currentColor" className="stroke-base-100" strokeWidth={2} />
        </>
      )}
    </svg>
  );
}
