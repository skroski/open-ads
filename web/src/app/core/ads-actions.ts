import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GoogleAdsApi } from '../data/google-ads.api';
import { ChangeEntry, KeywordRow, MatchType } from '../domain/models';
import { AccountStore } from './account.store';
import { ChangesStore } from './collections';
import { describeError } from './dataset';
import { Workspace } from './workspace';

export interface ActionResult {
  ok: boolean;
  message: string;
  operations?: number;
}

const MATCH_WORD: Record<MatchType, string> = { EXACT: 'exata', PHRASE: 'de frase', BROAD: 'ampla' };

/**
 * Único ponto que altera a conta do Google Ads. Toda mudança bem-sucedida é
 * registrada no histórico (com a data, para medir o efeito depois) e os dados
 * em tela são atualizados sem recarregar tudo.
 */
@Injectable({ providedIn: 'root' })
export class AdsActions {
  private readonly api = inject(GoogleAdsApi);
  private readonly ws = inject(Workspace);
  private readonly account = inject(AccountStore);
  private readonly changes = inject(ChangesStore);

  /** Recurso (palavra) com uma operação em andamento — para desabilitar o botão certo. */
  readonly busyResource = signal<string | null>(null);

  private log(entry: Omit<ChangeEntry, 'id' | 'accountId' | 'at' | 'source'>): void {
    void this.changes.add({
      ...entry,
      at: new Date().toISOString().slice(0, 19),
      source: 'APP',
      author: 'Painel',
    });
  }

  async negateTerms(
    terms: readonly string[],
    options: { matchType: MatchType; campaignId?: string; campaignIds?: string[] },
  ): Promise<ActionResult> {
    const customer = this.account.selectedId();
    try {
      const res = await firstValueFrom(
        this.api.addNegatives([...terms], options, customer),
      );
      const total = res.totalOperations ?? terms.length;
      const scope = options.campaignId
        ? this.ws.campaigns.value()?.find((c) => c.id === options.campaignId)?.name ?? 'campanha selecionada'
        : `${options.campaignIds?.length ?? 0} campanhas`;
      this.log({
        kind: 'NEGATIVE',
        title: `Negativou ${terms.length} ${terms.length === 1 ? 'termo' : 'termos'} (correspondência ${MATCH_WORD[options.matchType]})`,
        description: `Escopo: ${scope}. Termos: ${terms.slice(0, 12).join(', ')}${terms.length > 12 ? '…' : ''}`,
        campaignId: options.campaignId,
        expected: 'Menos cliques pagos sem resultado nesses termos.',
      });
      this.ws.negatives.reload();
      return {
        ok: true,
        operations: total,
        message: `${terms.length} ${terms.length === 1 ? 'termo negativado' : 'termos negativados'} (${total} operações aplicadas).`,
      };
    } catch (e) {
      return { ok: false, message: describeError(e) };
    }
  }

  async addNegative(campaignId: string, text: string, matchType: MatchType): Promise<ActionResult> {
    const customer = this.account.selectedId();
    try {
      await firstValueFrom(this.api.addNegative(campaignId, text, matchType, customer));
      this.log({
        kind: 'NEGATIVE',
        title: `Negativou "${text}" (correspondência ${MATCH_WORD[matchType]})`,
        campaignId,
        expected: 'Bloquear esse tráfego sem intenção de compra.',
      });
      this.ws.negatives.reload();
      return { ok: true, message: `"${text}" negativada com sucesso.` };
    } catch (e) {
      return { ok: false, message: describeError(e) };
    }
  }

  async setKeywordStatus(kw: KeywordRow, status: 'ENABLED' | 'PAUSED'): Promise<ActionResult> {
    this.busyResource.set(kw.resourceName);
    try {
      await firstValueFrom(this.api.setKeywordStatus(kw.resourceName, status, this.account.selectedId()));
      this.ws.keywordsBase.patch((list) =>
        list.map((k) => (k.resourceName === kw.resourceName ? { ...k, status } : k)),
      );
      this.log({
        kind: 'KEYWORD',
        title: `${status === 'PAUSED' ? 'Pausou' : 'Reativou'} a palavra "${kw.text}"`,
        description: `Campanha: ${kw.campaignName} · Grupo: ${kw.adGroupName}`,
        campaignId: kw.campaignId,
        entity: { type: 'keyword', id: kw.criterionId, label: kw.text },
        expected:
          status === 'PAUSED'
            ? 'Cortar o custo desta palavra. Contatos podem cair junto: confira o resultado.'
            : 'Voltar a receber tráfego desta palavra.',
      });
      return {
        ok: true,
        message: `Palavra "${kw.text}" ${status === 'PAUSED' ? 'pausada' : 'reativada'}.`,
      };
    } catch (e) {
      return { ok: false, message: describeError(e) };
    } finally {
      this.busyResource.set(null);
    }
  }

  async removeKeyword(kw: KeywordRow): Promise<ActionResult> {
    this.busyResource.set(kw.resourceName);
    try {
      await firstValueFrom(this.api.removeKeyword(kw.resourceName, this.account.selectedId()));
      this.ws.keywordsBase.patch((list) => list.filter((k) => k.resourceName !== kw.resourceName));
      this.log({
        kind: 'KEYWORD',
        title: `Excluiu a palavra "${kw.text}"`,
        description: `Campanha: ${kw.campaignName} · Grupo: ${kw.adGroupName}`,
        campaignId: kw.campaignId,
        entity: { type: 'keyword', id: kw.criterionId, label: kw.text },
        expected: 'Parar de gastar com esta palavra.',
      });
      return { ok: true, message: `Palavra "${kw.text}" excluída do Google Ads.` };
    } catch (e) {
      return { ok: false, message: describeError(e) };
    } finally {
      this.busyResource.set(null);
    }
  }

  async setKeywordBid(kw: KeywordRow, amount: number): Promise<ActionResult> {
    this.busyResource.set(kw.resourceName);
    try {
      await firstValueFrom(this.api.setKeywordBid(kw.resourceName, amount, this.account.selectedId()));
      this.ws.keywordsBase.patch((list) =>
        list.map((k) => (k.resourceName === kw.resourceName ? { ...k, bid: amount } : k)),
      );
      this.log({
        kind: 'BID',
        title: `Definiu teto de CPC de R$ ${amount.toFixed(2).replace('.', ',')} em "${kw.text}"`,
        description: `Campanha: ${kw.campaignName} · Grupo: ${kw.adGroupName}`,
        campaignId: kw.campaignId,
        entity: { type: 'keyword', id: kw.criterionId, label: kw.text },
        expected: 'Reduzir o CPC médio desta palavra; o volume de cliques pode cair.',
      });
      return {
        ok: true,
        message: `Teto de R$ ${amount.toFixed(2).replace('.', ',')} aplicado em "${kw.text}".`,
      };
    } catch (e) {
      return { ok: false, message: describeError(e) };
    } finally {
      this.busyResource.set(null);
    }
  }
}
