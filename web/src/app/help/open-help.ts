export type OpenHelpPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface OpenHelpStep {
  id: string;
  title: string;
  body: string;
  narration: string;
  target: string;
  placement: OpenHelpPlacement;
  optional?: boolean;
}

export interface OpenHelpJourney {
  id: string;
  version: number;
  language: string;
  steps: readonly OpenHelpStep[];
}

export interface VoiceProvider {
  speak(text: string, language: string, audioSrc: string): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}

/** Toca exclusivamente o MP3 entregue pelo app; nunca chama um provedor nem recebe credenciais. */
export class PreRenderedVoiceProvider implements VoiceProvider {
  private muted = false;
  private audio?: HTMLAudioElement;

  async speak(_text: string, _language: string, audioSrc: string): Promise<void> {
    if (this.muted || typeof Audio === 'undefined') return;
    this.stop();
    const audio = new Audio(audioSrc);
    this.audio = audio;
    try {
      await audio.play();
    } catch {
      // A ajuda segue disponível visualmente quando um arquivo estiver indisponível.
      if (this.audio === audio) this.audio = undefined;
    } finally {
      audio.onended = () => {
        if (this.audio === audio) this.audio = undefined;
      };
    }
  }

  stop(): void {
    this.audio?.pause();
    if (this.audio) this.audio.currentTime = 0;
    this.audio = undefined;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
  }

  destroy(): void {
    this.stop();
  }
}

export class OpenHelpEngine {
  private index = 0;
  private muted = false;
  private running = false;
  private root?: HTMLElement;
  private spotlight?: HTMLElement;
  private popover?: HTMLElement;
  private origin?: HTMLElement;
  private cleanup = () => undefined;

  constructor(
    private readonly journey: OpenHelpJourney,
    private readonly voice: VoiceProvider,
    private readonly onError: (message: string) => void,
  ) {}

  async start(origin: HTMLElement): Promise<void> {
    if (typeof document === 'undefined') return;
    this.stop(false);
    this.running = true;
    this.origin = origin;
    this.index = 0;
    await this.showCurrent();
  }

  async next(): Promise<void> {
    this.voice.stop();
    this.index += 1;
    await this.showCurrent();
  }

  async back(): Promise<void> {
    this.voice.stop();
    this.index = Math.max(0, this.index - 1);
    await this.showCurrent();
  }

  repeat(): void {
    const step = this.journey.steps[this.index];
    if (step) void this.speak(step);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.voice.setMuted(this.muted);
    this.renderCurrent();
  }

  complete(): void {
    this.setCompleted();
    this.stop(true);
  }

  stop(returnFocus: boolean): void {
    this.running = false;
    this.voice.stop();
    this.cleanup();
    this.cleanup = () => undefined;
    this.root?.remove();
    this.root = undefined;
    this.spotlight = undefined;
    this.popover = undefined;
    if (returnFocus) this.origin?.focus();
  }

  destroy(): void {
    this.stop(false);
    this.voice.destroy();
  }

  private async showCurrent(): Promise<void> {
    if (!this.running) return;
    const step = this.journey.steps[this.index];
    if (!step) {
      this.complete();
      return;
    }
    const target = await this.findTarget(step.target, !step.optional);
    if (!this.running) return;
    if (!target) {
      if (step.optional) {
        await this.next();
        return;
      }
      this.stop(true);
      this.onError('A ajuda não encontrou esta parte da tela. Atualize a página e tente novamente.');
      return;
    }
    this.render(target, step);
    if (!this.muted) void this.speak(step);
  }

  private async findTarget(selector: string, waitForTarget: boolean): Promise<HTMLElement | undefined> {
    const immediate = visibleTarget(selector);
    if (immediate || !waitForTarget) return immediate;
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const found = visibleTarget(selector);
        if (found) finish(found);
      });
      const timeout = window.setTimeout(() => finish(undefined), 4_000);
      const finish = (found: HTMLElement | undefined): void => {
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve(found);
      };
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    });
  }

  private render(target: HTMLElement, step: OpenHelpStep): void {
    this.stop(false);
    this.running = true;
    const root = document.createElement('div');
    root.className = 'open-help';
    const spotlight = document.createElement('div');
    spotlight.className = 'open-help__spotlight';
    const popover = document.createElement('section');
    popover.className = 'open-help__popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    popover.setAttribute('aria-labelledby', 'open-help-title');
    root.append(spotlight, popover);
    document.body.append(root);
    this.root = root;
    this.spotlight = spotlight;
    this.popover = popover;
    this.renderCurrent(target, step);
    const refresh = () => this.position(target, step.placement);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    document.addEventListener('keydown', this.onKeydown);
    this.cleanup = () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
      document.removeEventListener('keydown', this.onKeydown);
    };
    requestAnimationFrame(() => {
      refresh();
      popover.querySelector<HTMLElement>('[data-open-help-primary]')?.focus();
    });
  }

  private renderCurrent(target?: HTMLElement, step?: OpenHelpStep): void {
    const current = step ?? this.journey.steps[this.index];
    const popover = this.popover;
    if (!current || !popover) return;
    popover.replaceChildren();
    const header = document.createElement('div');
    header.className = 'open-help__header';
    const progress = document.createElement('span');
    progress.className = 'open-help__progress';
    progress.textContent = `${this.index + 1} de ${this.journey.steps.length}`;
    const close = actionButton('Fechar ajuda', 'open-help__icon-button', () => this.stop(true));
    header.append(progress, close);
    const title = document.createElement('h2');
    title.id = 'open-help-title';
    title.className = 'open-help__title';
    title.textContent = current.title;
    const body = document.createElement('p');
    body.className = 'open-help__body';
    body.textContent = current.body;
    const controls = document.createElement('div');
    controls.className = 'open-help__voice-controls';
    controls.append(
      actionButton('Repetir áudio', 'open-help__text-button', () => this.repeat()),
      actionButton(this.muted ? 'Ativar áudio' : 'Silenciar áudio', 'open-help__text-button', () => this.toggleMute()),
    );
    const footer = document.createElement('div');
    footer.className = 'open-help__footer';
    if (this.index > 0) footer.append(actionButton('Voltar', 'open-help__secondary-button', () => void this.back()));
    const next = actionButton(
      this.index === this.journey.steps.length - 1 ? 'Concluir' : 'Próximo',
      'open-help__primary-button',
      () => (this.index === this.journey.steps.length - 1 ? this.complete() : void this.next()),
    );
    next.dataset['openHelpPrimary'] = '';
    footer.append(next);
    popover.append(header, title, body, controls, footer);
    if (target) this.position(target, current.placement);
  }

  private position(target: HTMLElement, placement: OpenHelpPlacement): void {
    if (!this.spotlight || !this.popover) return;
    const rect = target.getBoundingClientRect();
    const margin = 10;
    this.spotlight.style.left = `${Math.max(0, rect.left - 4)}px`;
    this.spotlight.style.top = `${Math.max(0, rect.top - 4)}px`;
    this.spotlight.style.width = `${rect.width + 8}px`;
    this.spotlight.style.height = `${rect.height + 8}px`;
    const popoverRect = this.popover.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + margin;
    if (placement === 'top') top = rect.top - popoverRect.height - margin;
    if (placement === 'right') {
      left = rect.right + margin;
      top = rect.top;
    }
    if (placement === 'left') {
      left = rect.left - popoverRect.width - margin;
      top = rect.top;
    }
    left = Math.min(Math.max(margin, left), window.innerWidth - popoverRect.width - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - popoverRect.height - margin);
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  private speak(step: OpenHelpStep): Promise<void> {
    return this.voice.speak(step.narration, this.journey.language, this.audioSrc(step));
  }

  private audioSrc(step: OpenHelpStep): string {
    return `/open-help/v${this.journey.version}/${step.id}.mp3`;
  }

  private setCompleted(): void {
    try {
      localStorage.setItem(`open-help:${this.journey.id}:v${this.journey.version}`, 'completed');
    } catch {
      /* Navegação privada: a ajuda continua disponível na sessão. */
    }
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.stop(true);
  };
}

function actionButton(label: string, className: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function visibleTarget(selector: string): HTMLElement | undefined {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return undefined;
  const style = window.getComputedStyle(target);
  const rect = target.getBoundingClientRect();
  const isInViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  return style.display !== 'none' && style.visibility !== 'hidden' && target.getClientRects().length && isInViewport ? target : undefined;
}
