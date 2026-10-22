import { HttpErrorResponse } from '@angular/common/http';
import { ResourceRef, computed, resource, signal } from '@angular/core';

/** Extrai uma mensagem legível de qualquer erro vindo de um carregamento. */
export function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { error?: unknown } | string | null;
    if (body && typeof body === 'object' && body.error) return String(body.error);
    if (typeof body === 'string' && body.trim()) return body.slice(0, 400);
    if (error.status === 0) return 'Sem conexão com o servidor. Verifique se o proxy local está rodando.';
    return `${error.status} ${error.statusText}`.trim();
  }
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Erro desconhecido';
}

/**
 * Conjunto de dados carregado sob demanda. Só dispara a consulta quando alguma tela
 * chama `need()`; depois disso recarrega sozinho quando a conta ou o período mudam.
 * Isso evita buscar 15 consultas do Google Ads para quem só abriu uma tela.
 */
export class Dataset<T, P extends object = object> {
  private readonly wanted = signal(false);
  private readonly loaded = signal<number | null>(null);
  private readonly resourceRef: ResourceRef<T | undefined>;

  readonly value = computed<T | undefined>(() => {
    if (this.resourceRef.error()) return undefined;
    try {
      return this.resourceRef.value();
    } catch {
      return undefined;
    }
  });
  readonly loading = computed(() => this.wanted() && this.resourceRef.isLoading());
  readonly error = computed<string | null>(() => {
    const e = this.resourceRef.error();
    return e ? describeError(e) : null;
  });
  readonly requested = this.wanted.asReadonly();
  /** Momento (ms) da última carga concluída com sucesso. */
  readonly loadedAt = this.loaded.asReadonly();

  constructor(
    paramsFn: () => P | undefined,
    loader: (params: P, abortSignal: AbortSignal) => Promise<T>,
  ) {
    this.resourceRef = resource<T, P | undefined>({
      params: () => (this.wanted() ? paramsFn() : undefined),
      loader: async ({ params, abortSignal }) => {
        const value = await loader(params as P, abortSignal);
        this.loaded.set(Date.now());
        return value;
      },
    });
  }

  /** Marca o conjunto como necessário (idempotente). */
  need(): void {
    if (!this.wanted()) this.wanted.set(true);
  }

  reload(): void {
    if (this.wanted()) this.resourceRef.reload();
  }

  /** Atualização otimista após uma mutação bem-sucedida (evita recarregar tudo). */
  patch(updater: (current: T) => T): void {
    const current = this.resourceRef.value();
    if (current !== undefined) this.resourceRef.value.set(updater(current));
  }
}
