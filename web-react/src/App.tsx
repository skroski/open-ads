import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AUTHOR, BRAND, DONATION } from '@shared/brand';
import { DATE_RANGE_OPTIONS, isoDate, type DateRangeOption, type DateWindow } from '@shared/domain/dates';
import { Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { isPersistent } from './lib/localDb';
import { NAV_SECTIONS, sectionForUrl } from './nav';
import { Placeholder } from './Placeholder';
import { useAccount } from './state/account';
import { useWorkspace } from './state/workspace';
import { useResolvedTheme, useTheme } from './theme';

/** Cada tela é carregada só quando aberta (o Angular também carrega as rotas sob demanda). */
const Overview = lazy(() => import('./features/overview/Overview').then((m) => ({ default: m.Overview })));

/** "14 set – 13 out 2026". */
function rangeText(w: DateWindow): string {
  const fmt = (iso: string, year: boolean): string => {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const txt = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
    return txt.replace(/\./g, '').replace(/ de /g, ' ');
  };
  return w.from === w.to ? fmt(w.to, true) : `${fmt(w.from, false)} – ${fmt(w.to, true)}`;
}

const formatId = (id: string): string => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

/** Relógio de 30 em 30 segundos, só para o texto "atualizado há X min". */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const SIDEBAR_KEY = 'openads_sidebar_collapsed';

function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, String(next));
    } catch {
      /* armazenamento local desativado */
    }
  };
  return [collapsed, toggle];
}

function freshness(at: number | null, now: number): string | null {
  if (!at) return null;
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'Dados atualizados agora';
  if (min < 60) return `Dados atualizados há ${min} min`;
  return `Dados atualizados há ${Math.floor(min / 60)} h`;
}

export function App() {
  const [, setTheme] = useTheme();
  const dark = useResolvedTheme() === 'dark';
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [donationOpen, setDonationOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const account = useAccount();
  const ws = useWorkspace();
  const now = useNow();
  const fresh = freshness(ws.lastLoadedAt, now);
  const location = useLocation();

  const periodMenuRef = useRef<HTMLDetailsElement>(null);
  const [customFrom, setCustomFrom] = useState(() => account.customRange?.from ?? '');
  const [customTo, setCustomTo] = useState(() => account.customRange?.to ?? '');
  const [customError, setCustomError] = useState<string | null>(null);
  const todayIso = useMemo(() => isoDate(new Date()), []);

  const activeSection = useMemo(() => sectionForUrl(location.pathname), [location.pathname]);
  const presetRanges = useMemo(() => DATE_RANGE_OPTIONS.filter((o) => o.value !== 'CUSTOM'), []);

  const closeDrawer = (): void => {
    const toggle = document.getElementById('app-drawer') as HTMLInputElement | null;
    if (toggle) toggle.checked = false;
  };

  const pickRange = (range: DateRangeOption): void => {
    account.setRange(range);
    if (periodMenuRef.current) periodMenuRef.current.open = false;
  };

  const applyCustom = (e: React.FormEvent): void => {
    e.preventDefault();
    const error = account.setCustomRange(customFrom, customTo);
    setCustomError(error);
    if (!error && periodMenuRef.current) {
      periodMenuRef.current.open = false;
    }
  };

  const copyPix = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(DONATION.pixKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // Coleta todas as rotas filhas e principais para garantir mapeamento completo de rotas
  const allRoutes = useMemo(() => {
    const routesMap = new Map<string, string>();
    for (const section of NAV_SECTIONS) {
      routesMap.set(section.path, section.label);
      for (const tab of section.tabs) {
        routesMap.set(tab.path, tab.label);
      }
    }
    return Array.from(routesMap.entries()).map(([path, label]) => ({ path, label }));
  }, []);

  return (
    <div className="drawer lg:drawer-open">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex min-h-screen min-w-0 flex-col bg-base-200">
        <header className="navbar sticky top-0 z-30 h-auto min-h-16 flex-wrap gap-2 border-b border-base-300 bg-base-100 px-3 py-2 sm:px-4 lg:flex-nowrap">
          <div className="flex-none lg:hidden">
            <label htmlFor="app-drawer" className="btn btn-square btn-sm" aria-label="Abrir menu de navegação">
              <Icon name="menu" />
            </label>
          </div>
          <div className="flex items-center gap-1.5 lg:hidden">
            <Logo variant="symbol" className="size-7 object-contain" />
          </div>
          <div className="hidden flex-none lg:flex">
            <button
              type="button"
              className="btn btn-ghost btn-square btn-sm text-base-content/70 hover:text-base-content"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
              title={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            >
              <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size="sm" />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <details className="dropdown">
              <summary
                className="btn h-auto min-h-[38px] max-w-full justify-start gap-2 border-base-300 bg-base-100 px-3 py-1 font-normal sm:max-w-72"
                aria-label="Conta do Google Ads"
              >
                <Icon name="building" size="sm" className="text-base-content/60" />
                <span className="flex min-w-0 flex-col items-start leading-tight">
                  <span className="max-w-full truncate text-sm font-medium">{ws.accountName || 'Escolher conta'}</span>
                  {account.selectedId && <span className="text-xs text-base-content/60">ID {formatId(account.selectedId)}</span>}
                </span>
                <Icon name="chevron-down" size="xs" className="ml-auto text-base-content/60" />
              </summary>
              <div className="dropdown-content z-50 mt-1 w-72 rounded-box border border-base-300 bg-base-100 p-1.5 shadow-lg">
                <div className="px-3 pt-2 pb-2 font-display text-xs font-semibold uppercase tracking-[0.08em] text-base-content/60">Contas</div>
                <ul className="menu w-full p-0">
                  {account.accounts.map((a) => (
                    <li key={a.id}>
                      <button type="button" className={a.id === account.selectedId ? 'menu-active' : ''} onClick={() => account.select(a.id)}>
                        <span className="flex min-w-0 flex-col items-start leading-tight">
                          <span className="max-w-full truncate">{a.name}</span>
                          <span className="text-xs text-base-content/60">ID {formatId(a.id)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 border-t border-base-300 px-3 pt-2 pb-1 text-xs text-base-content/60">
                  Para cadastrar ou importar contas, use o painel Angular (Oficial).
                </p>
              </div>
            </details>

            <details ref={periodMenuRef} className="dropdown">
              <summary className="btn h-auto min-h-[38px] justify-start gap-2 border-base-300 bg-base-100 px-3 py-1 font-normal" aria-label="Período de análise">
                <Icon name="calendar" size="sm" className="text-base-content/60" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="whitespace-nowrap text-sm font-medium">{account.rangeLabel}</span>
                  <span className="whitespace-nowrap text-xs text-base-content/60">{rangeText(account.window)}</span>
                </span>
                <Icon name="chevron-down" size="xs" className="text-base-content/60" />
              </summary>
              <div className="dropdown-content z-50 mt-1 w-64 rounded-box border border-base-300 bg-base-100 p-1.5 shadow-lg">
                <div className="px-3 pt-2 pb-2 font-display text-xs font-semibold uppercase tracking-[0.08em] text-base-content/60">Período</div>
                <ul className="menu w-full p-0">
                  {presetRanges.map((r) => (
                    <li key={r.value}>
                      <button type="button" className={r.value === account.range ? 'menu-active' : ''} onClick={() => pickRange(r.value)}>
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <form className="mt-1 border-t border-base-300 px-3 pt-3 pb-2" onSubmit={applyCustom}>
                  <div className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-base-content/60">Intervalo de datas</div>
                  <label className="mt-2 block text-xs text-base-content/70">
                    De
                    <input
                      type="date"
                      className="input input-sm mt-1 w-full"
                      name="customFrom"
                      max={todayIso}
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                    />
                  </label>
                  <label className="mt-2 block text-xs text-base-content/70">
                    Até
                    <input
                      type="date"
                      className="input input-sm mt-1 w-full"
                      name="customTo"
                      max={todayIso}
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                    />
                  </label>
                  {customError && <p role="alert" className="mt-2 text-xs text-error">{customError}</p>}
                  <button type="submit" className="btn btn-sm btn-primary mt-3 w-full">Aplicar intervalo</button>
                </form>
                <p className="mt-1 border-t border-base-300 px-3 pt-2 pb-1 text-xs text-base-content/60">Comparação feita com o período anterior de mesma duração.</p>
              </div>
            </details>
          </div>

          <div className="flex flex-none items-center gap-3">
            {ws.anyLoading ? (
              <span className="hidden items-center gap-2 text-sm text-base-content/60 sm:flex">
                <span className="loading loading-spinner loading-xs"></span> Atualizando…
              </span>
            ) : (
              fresh && (
                <span className="hidden items-center gap-2 text-sm text-base-content/60 sm:flex">
                  <span className="status status-success"></span> {fresh}
                </span>
              )
            )}
            <button
              type="button"
              className="btn btn-square border-base-300 bg-base-100"
              aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}
              title={dark ? 'Usar tema claro' : 'Usar tema escuro'}
              onClick={() => setTheme(dark ? 'light' : 'dark')}
            >
              <Icon name={dark ? 'sun' : 'moon'} size="sm" />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {!isPersistent() && (
            <div role="alert" className="alert alert-warning alert-soft mb-4">
              <Icon name="warning" />
              <span className="text-sm">
                Este navegador não permite salvar dados locais. Leads, conteúdos e histórico ficam só nesta sessão e somem ao fechar a aba.
              </span>
            </div>
          )}

          {account.discoveryError && (
            <div role="alert" className="alert alert-error alert-soft mb-4">
              <Icon name="warning" />
              <div className="min-w-0">
                <h3 className="font-semibold">Não foi possível consultar as contas do Google Ads</h3>
                <div className="break-words text-sm">{account.discoveryError}</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={account.discover}>
                Tentar novamente
              </button>
            </div>
          )}

          {activeSection && activeSection.tabs.length > 1 && (
            <>
              <div className="section-heading">
                <div className="section-heading__eyebrow">{activeSection.label}</div>
                <h1 className="section-heading__title">{activeSection.question}</h1>
                {activeSection.subtitle && <p className="section-heading__sub">{activeSection.subtitle}</p>}
              </div>
              <nav className="section-tabs" aria-label={`Seções de ${activeSection.label}`}>
                {activeSection.tabs.map((tab) => (
                  <NavLink
                    key={tab.path}
                    to={`/${tab.path}`}
                    className={({ isActive }) => (isActive ? 'section-tab section-tab--active' : 'section-tab')}
                  >
                    {tab.label}
                  </NavLink>
                ))}
              </nav>
            </>
          )}

          {!account.selectedId && !account.discoveryError ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <div className="skeleton h-24 w-full"></div>
              <div className="skeleton h-64 w-full"></div>
            </div>
          ) : (
            <Suspense fallback={<div className="skeleton h-64 w-full" aria-busy="true" aria-label="Carregando"></div>}>
              <Routes>
                <Route path="/" element={<Navigate to="/visao-geral" replace />} />
                {/* Telas já portadas para React */}
                <Route path="/visao-geral" element={<Overview />} />
                {/* As demais ainda são marcadores: a versão Oficial em Angular as oferece completas. */}
                {allRoutes
                  .filter((item) => item.path !== 'visao-geral')
                  .map((item) => (
                    <Route key={item.path} path={`/${item.path}`} element={<Placeholder title={item.label} />} />
                  ))}
                <Route path="*" element={<Navigate to="/visao-geral" replace />} />
              </Routes>
            </Suspense>
          )}
        </main>
      </div>

      <div className="drawer-side z-40">
        <label htmlFor="app-drawer" aria-label="Fechar menu" className="drawer-overlay" />
        <aside
          className={`ads-sidebar flex min-h-full flex-col border-r transition-[width] duration-200 ${collapsed ? 'w-[72px]' : 'w-72'}`}
          data-collapsed={collapsed}
        >
          <div className={`flex h-16 min-h-16 flex-none items-center border-b border-base-300 transition-all ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
            {collapsed ? (
              <button
                type="button"
                className="group flex size-11 cursor-pointer items-center justify-center rounded-xl transition-all hover:bg-base-200"
                onClick={toggleCollapsed}
                aria-label="Expandir menu lateral"
                title="Clique para expandir o menu lateral"
              >
                <Logo variant="symbol" className="size-8.5 object-contain transition-transform group-hover:scale-105" />
              </button>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <Logo variant="expanded" className="h-7 w-auto max-w-[155px] object-contain" />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-square btn-xs hidden text-base-content/60 hover:text-base-content lg:inline-flex"
                  onClick={toggleCollapsed}
                  aria-label="Recolher menu lateral"
                  title="Recolher menu lateral"
                >
                  <Icon name="chevron-left" size="xs" />
                </button>
              </>
            )}
          </div>

          <nav className={`grow overflow-y-auto pb-4 ${collapsed ? 'px-0 py-3' : 'px-2'}`} aria-label="Navegação principal" data-open-help="navegacao">
            {collapsed ? (
              <ul className="m-0 flex w-full list-none flex-col items-center gap-1.5 p-0">
                {NAV_SECTIONS.map((item) => (
                  <li key={item.path} className="flex w-full justify-center">
                    <div className="tooltip tooltip-right flex justify-center" data-tip={item.label}>
                      <NavLink
                        to={`/${item.path}`}
                        onClick={closeDrawer}
                        className={activeSection?.path === item.path ? 'retracted-item retracted-active' : 'retracted-item'}
                        title={item.label}
                        aria-label={item.label}
                      >
                        <Icon name={item.icon} size="md" />
                      </NavLink>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="menu w-full gap-1">
                {NAV_SECTIONS.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={`/${item.path}`}
                      onClick={closeDrawer}
                      className={activeSection?.path === item.path ? 'menu-active' : ''}
                      aria-current={activeSection?.path === item.path ? 'page' : undefined}
                    >
                      <Icon name={item.icon} size="sm" />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <div className={`flex flex-none flex-col gap-2 border-t border-base-300 py-3 transition-all ${collapsed ? 'items-center px-2' : 'px-6'}`}>
            {collapsed ? (
              <>
                <div className="tooltip tooltip-right" data-tip="Apoiar via PIX">
                  <button
                    type="button"
                    className="btn btn-ghost btn-square flex size-10.5 cursor-pointer items-center justify-center rounded-xl text-error transition-all hover:bg-base-200"
                    onClick={() => setDonationOpen(true)}
                    title="Apoiar via PIX"
                    aria-label="Apoiar via PIX"
                  >
                    <Icon name="heart" size="md" />
                  </button>
                </div>
                <span
                  className="cursor-default select-none pt-0.5 font-mono text-[10px] font-medium tracking-wider text-base-content/40 transition-colors hover:text-base-content/75"
                  title={`Criado por ${AUTHOR.name}`}
                  aria-label={`Criado por ${AUTHOR.name}`}
                >
                  DS
                </span>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs text-base-content/60">
                  <span>Criado por {AUTHOR.name}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-xs btn-outline w-full justify-start gap-1.5 border-base-300 text-base-content/80 hover:bg-base-200"
                  onClick={() => setDonationOpen(true)}
                  title="Colaborar voluntariamente com o projeto via PIX"
                >
                  <Icon name="heart" size="xs" className="text-error" />
                  <span>Apoiar via PIX</span>
                </button>
              </>
            )}
          </div>
        </aside>
      </div>

      <dialog className={donationOpen ? 'modal modal-open' : 'modal'} aria-label="Apoiar o OpenAds" open={donationOpen} onClose={() => setDonationOpen(false)}>
        <div className="modal-box max-w-sm">
          <div className="flex items-center gap-2 text-lg font-semibold text-base-content">
            <Icon name="heart" className="text-error" /> Apoiar o OpenAds
          </div>
          <p className="mt-2 text-sm text-base-content/80">
            Este sistema é e sempre será <strong>100% gratuito e de código aberto</strong>. Nunca haverá obrigação ou cobrança de qualquer tipo.
          </p>
          <p className="mt-2 text-sm text-base-content/70">
            Se o painel te ajudou a economizar e cortar desperdícios no Google Ads, qualquer valor ajuda para melhorar ainda mais!
          </p>
          <div className="mt-4 rounded-box border border-base-300 bg-base-200/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-base-content/60">Chave PIX ({DONATION.pixType})</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <code className="font-mono text-sm font-bold text-base-content selection:bg-primary/20">{DONATION.pixKey}</code>
              <button type="button" className="btn btn-sm btn-primary" onClick={copyPix}>
                <Icon name="copy" size="xs" /> {copied ? 'Chave copiada!' : 'Copiar chave'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-base-content/60">Muito obrigado pelo carinho e apoio ao projeto! ❤️</p>
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={() => setDonationOpen(false)}>
              Fechar
            </button>
          </div>
        </div>
        <button type="button" className="modal-backdrop" aria-label="Fechar" onClick={() => setDonationOpen(false)} />
      </dialog>
    </div>
  );
}
