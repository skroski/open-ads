import type { ReactNode } from 'react';
import { useWorkspace } from '../state/workspace';
import { Icon } from './Icon';

/**
 * Cabeçalho padrão das telas: grupo (rótulo pequeno), título, descrição e um espaço
 * à direita para ações. O botão "Atualizar dados" recarrega tudo o que já foi pedido.
 */
export function PageHeader({
  group,
  title,
  subtitle,
  refresh = true,
  children,
  helpId,
}: {
  group?: string;
  title: string;
  subtitle?: string;
  refresh?: boolean;
  children?: ReactNode;
  helpId?: string;
}) {
  const ws = useWorkspace();
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" data-open-help={helpId}>
      <div className="min-w-0">
        {group && <div className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.09em] text-base-content/60">{group}</div>}
        <h1 className="text-3xl leading-tight sm:text-4xl">
          <strong>{title}</strong>
        </h1>
        {subtitle && <p className="mt-2 max-w-3xl text-base text-base-content/70 text-pretty">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {refresh && (
          <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={ws.anyLoading} onClick={ws.reloadAll}>
            {ws.anyLoading ? <span className="loading loading-spinner loading-xs"></span> : <Icon name="refresh" size="sm" />}
            Atualizar dados
          </button>
        )}
      </div>
    </header>
  );
}
