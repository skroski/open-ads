import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Casca para qualquer bloco que depende de dados carregados: mostra esqueleto
 * enquanto carrega, o erro com "tentar novamente", ou o conteúdo.
 */
export function DataState({
  loading,
  error,
  hasData,
  title = 'Não foi possível carregar os dados',
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  title?: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (error) {
    return (
      <div role="alert" className="alert alert-error alert-soft">
        <Icon name="warning" />
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          <div className="text-sm break-words">{error}</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    );
  }
  if (loading && !hasData) {
    return (
      <div className="flex flex-col gap-block" aria-busy="true" aria-label="Carregando">
        <div className="skeleton h-24 w-full"></div>
        <div className="skeleton h-64 w-full"></div>
      </div>
    );
  }
  return <div className="flex flex-col gap-block">{children}</div>;
}
