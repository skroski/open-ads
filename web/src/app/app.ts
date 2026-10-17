import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AUTHOR, BRAND, DONATION } from './brand';
import { AccountStore } from './core/account.store';
import { LocalDb } from './core/local-db';
import { ToastService } from './core/toast.service';
import { Workspace } from './core/workspace';
import { DATE_RANGE_OPTIONS, DateRangeOption, DateWindow } from './domain/dates';
import { AccountModal } from './shared/account-modal';
import { BatchNegativeModal } from './shared/batch-negative-modal';
import { Icon } from './shared/icon';
import { IconName } from './shared/icons';
import { AppModal } from './shared/modal';
import { ThemeToggle } from './shared/theme-toggle';
import { Toasts } from './shared/toasts';
import { ONBOARDING_JOURNEY } from './help/onboarding-journey';
import { OpenHelpEngine, PreRenderedVoiceProvider } from './help/open-help';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Inteligência',
    items: [
      { path: 'visao-geral', label: 'Visão geral', icon: 'home' },
      { path: 'funil', label: 'Qualidade do funil', icon: 'funnel' },
      { path: 'desperdicios', label: 'Desperdícios', icon: 'ban' },
      { path: 'intencao', label: 'Intenção e páginas', icon: 'link' },
      { path: 'conteudo', label: 'Conteúdo', icon: 'document' },
      { path: 'acoes', label: 'Plano de ação', icon: 'clipboard' },
      { path: 'historico', label: 'Histórico e aprendizado', icon: 'history' },
    ],
  },
  {
    title: 'Operação no Google Ads',
    items: [
      { path: 'termos', label: 'Termos de pesquisa', icon: 'search' },
      { path: 'negativas', label: 'Palavras negativas', icon: 'shield' },
      { path: 'palavras', label: 'Palavras-chave', icon: 'tag' },
      { path: 'campanhas', label: 'Campanhas', icon: 'folder' },
      { path: 'dispositivos', label: 'Dispositivos e redes', icon: 'desktop' },
    ],
  },
  {
    title: 'Sistema',
    items: [{ path: 'configuracoes', label: 'Configurações', icon: 'cog' }],
  },
];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Icon,
    ThemeToggle,
    Toasts,
    AccountModal,
    AppModal,
    BatchNegativeModal,
  ],
  templateUrl: './app.html',
})
export class App {
  protected readonly brand = BRAND;
  protected readonly author = AUTHOR;
  protected readonly donation = DONATION;
  protected readonly account = inject(AccountStore);
  protected readonly ws = inject(Workspace);
  protected readonly db = inject(LocalDb);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly groups = NAV_GROUPS;
  protected readonly ranges = DATE_RANGE_OPTIONS;
  protected readonly accountModalOpen = signal(false);
  protected readonly donationModalOpen = signal(false);
  private readonly help = new OpenHelpEngine(
    ONBOARDING_JOURNEY,
    new PreRenderedVoiceProvider(),
    (message) => this.toast.warning(message),
  );

  private readonly drawer = viewChild.required<ElementRef<HTMLInputElement>>('drawerToggle');
  private readonly periodMenu = viewChild<ElementRef<HTMLDetailsElement>>('periodMenu');

  /** Relógio de 30 em 30 segundos, só para o texto "atualizado há X min". */
  private readonly now = signal(Date.now());

  protected readonly freshness = computed(() => {
    const at = this.ws.lastLoadedAt();
    if (!at) return null;
    const min = Math.floor((this.now() - at) / 60_000);
    if (min < 1) return 'Dados atualizados agora';
    if (min < 60) return `Dados atualizados há ${min} min`;
    const h = Math.floor(min / 60);
    return `Dados atualizados há ${h} h`;
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.help.destroy();
    });
    this.router.events.pipe(filter((event): event is NavigationStart => event instanceof NavigationStart)).subscribe(() => this.help.stop(false));
  }

  protected closeDrawer(): void {
    this.drawer().nativeElement.checked = false;
  }

  protected startHelp(event: MouseEvent): void {
    this.closeDrawer();
    void this.help.start(event.currentTarget as HTMLElement);
  }

  protected pickRange(value: DateRangeOption): void {
    this.account.setRange(value);
    const menu = this.periodMenu()?.nativeElement;
    if (menu) menu.open = false;
  }

  protected formatId(id: string): string {
    return id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
  }

  /** "14 set – 13 out 2026". */
  protected rangeText(w: DateWindow): string {
    const fmt = (iso: string, year: boolean): string => {
      const [y, m, d] = iso.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const txt = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
      return txt.replace(/\./g, '').replace(/ de /g, ' ');
    };
    return w.from === w.to ? fmt(w.to, true) : `${fmt(w.from, false)} – ${fmt(w.to, true)}`;
  }

  protected async copyPix(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.donation.pixKey);
      this.toast.success('Chave PIX copiada! Muito obrigado pelo apoio.');
    } catch {
      this.toast.warning('Não foi possível copiar automaticamente.');
    }
  }
}
