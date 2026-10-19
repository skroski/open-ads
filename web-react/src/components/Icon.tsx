import { ICONS, type IconName } from '@shared/shared/icons';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Classes completas (o Tailwind precisa enxergar cada nome inteiro no código-fonte). */
const SIZE_CLASS: Record<IconSize, string> = {
  xs: 'size-3.5',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-8',
};

/** Ícones de traço do Oficial (`shared/icons.ts`), os mesmos caminhos SVG. */
export function Icon({ name, size = 'md', stroke = 1.75, className = '' }: { name: IconName; size?: IconSize; stroke?: number; className?: string }) {
  return (
    <span className={`inline-block shrink-0 align-middle ${SIZE_CLASS[size]} ${className}`.trim()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-full">
        {ICONS[name].map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    </span>
  );
}
