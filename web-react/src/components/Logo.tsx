import { BRAND } from '@shared/brand';
import { useResolvedTheme } from '../theme';

/**
 * Logo oficial do OpenAds, como no Angular: no tema escuro usa a versão clara e vice-versa.
 * `expanded` é o logo completo; `symbol`, só o símbolo.
 */
export function Logo({ variant = 'expanded', alt = 'OpenAds', className }: { variant?: 'expanded' | 'symbol'; alt?: string; className?: string }) {
  const dark = useResolvedTheme() !== 'dark';
  const symbol = variant === 'symbol';
  const src = symbol ? (dark ? BRAND.logos.symbolDark : BRAND.logos.symbolLight) : dark ? BRAND.logos.expandedDark : BRAND.logos.expandedLight;
  const fallback = symbol ? 'size-9 object-contain select-none' : 'h-8 w-auto max-w-[170px] object-contain select-none';
  return (
    <span className="inline-flex items-center justify-center">
      <img src={src} alt={alt} width={symbol ? 168 : 619} height={168} className={className ?? fallback} loading="eager" decoding="async" />
    </span>
  );
}
