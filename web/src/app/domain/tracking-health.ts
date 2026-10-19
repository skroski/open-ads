/**
 * Diagnóstico puro de rastreamento. Não conhece Angular, Google Ads nem GTM: o
 * adaptador só precisa fornecer o inventário sanitizado e, opcionalmente, a
 * leitura do HTML das páginas. Isso permite trocar a origem dos dados depois.
 */

export type ConsentStatus = 'NEEDED' | 'NOT_NEEDED' | 'NOT_SET' | 'UNKNOWN';
export type TrackingSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type TrackingEvidenceKind = 'FACT' | 'HYPOTHESIS';

export interface TrackingTagSnapshot {
  id: string;
  name: string;
  type: string;
  paused: boolean;
  firingTriggerIds: string[];
  consentStatus: ConsentStatus;
}

export interface TrackingEntitySnapshot {
  id: string;
  name: string;
  type: string;
}

export interface TrackingSnapshot {
  workspacePath: string;
  tags: TrackingTagSnapshot[];
  triggers: TrackingEntitySnapshot[];
  variables: TrackingEntitySnapshot[];
}

export interface TrackingPageProbe {
  url: string;
  /** Nulo significa que ainda não houve leitura da página. */
  trackingTags: readonly string[] | null;
  readable: boolean;
}

/** Fonte externa de conversão; Google Ads é apenas um dos adaptadores possíveis. */
export interface TrackingConversionDefinition {
  id: string;
  name: string;
  active: boolean;
}

export interface TrackingFinding {
  id: string;
  severity: TrackingSeverity;
  evidenceKind: TrackingEvidenceKind;
  title: string;
  detail: string;
  source: 'GOOGLE_TAG_MANAGER' | 'GOOGLE_ADS' | 'SITE';
}

export interface TrackingHealthReport {
  findings: TrackingFinding[];
  pagesPendingAudit: number;
  pagesWithoutGoogleTag: number;
  tagsWithConsent: number;
  customEventTriggers: number;
  conversionActionsWithoutTag: number;
}

export interface TrackingChangeSet {
  addedTags: TrackingTagSnapshot[];
  removedTags: TrackingTagSnapshot[];
  changedTags: Array<{ before: TrackingTagSnapshot; after: TrackingTagSnapshot }>;
  changed: boolean;
}

const conversionWords = /\b(convers[aã]o|conversion|purchase|compra|lead|formul[aá]rio|whatsapp|telefone|contato)\b/i;

function looksLikeConversion(tag: TrackingTagSnapshot): boolean {
  return conversionWords.test(`${tag.name} ${tag.type}`);
}

function words(value: string): string[] {
  return (
    value
      .toLocaleLowerCase('pt-BR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]{4,}/g) ?? []
  );
}

function resemblesTag(action: TrackingConversionDefinition, tags: readonly TrackingTagSnapshot[]): boolean {
  const actionWords = words(action.name).filter((word) => !['google', 'ads', 'conversao', 'conversion'].includes(word));
  return actionWords.some((word) => tags.some((tag) => words(`${tag.name} ${tag.type}`).includes(word)));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

function sameTag(a: TrackingTagSnapshot, b: TrackingTagSnapshot): boolean {
  return a.name === b.name && a.type === b.type && a.paused === b.paused && a.consentStatus === b.consentStatus && sameList(a.firingTriggerIds, b.firingTriggerIds);
}

/** Compara dois inventários sanitizados; parâmetros e valores de tag ficam fora disso. */
export function diffTrackingSnapshots(before: TrackingSnapshot, after: TrackingSnapshot): TrackingChangeSet {
  const oldById = new Map(before.tags.map((tag) => [tag.id, tag]));
  const newById = new Map(after.tags.map((tag) => [tag.id, tag]));
  const addedTags = after.tags.filter((tag) => !oldById.has(tag.id));
  const removedTags = before.tags.filter((tag) => !newById.has(tag.id));
  const changedTags = after.tags.flatMap((tag) => {
    const old = oldById.get(tag.id);
    return old && !sameTag(old, tag) ? [{ before: old, after: tag }] : [];
  });
  return { addedTags, removedTags, changedTags, changed: !!(addedTags.length || removedTags.length || changedTags.length) };
}

export function analyzeTracking(
  snapshot: TrackingSnapshot,
  pages: readonly TrackingPageProbe[],
  conversions: readonly TrackingConversionDefinition[] = [],
): TrackingHealthReport {
  const findings: TrackingFinding[] = [];
  const paused = snapshot.tags.filter((tag) => tag.paused);
  const noTrigger = snapshot.tags.filter((tag) => !tag.paused && tag.firingTriggerIds.length === 0);
  const conversionCandidates = snapshot.tags.filter(looksLikeConversion);
  const pausedConversions = conversionCandidates.filter((tag) => tag.paused);
  const pagesRead = pages.filter((page) => page.trackingTags !== null && page.readable);
  const pagesWithoutGoogleTag = pagesRead.filter((page) => !page.trackingTags!.some((tag) => tag === 'gtm' || tag === 'gtag' || tag === 'ga')).length;
  const tagsWithConsent = snapshot.tags.filter((tag) => tag.consentStatus === 'NEEDED').length;
  const customEventTriggers = snapshot.triggers.filter((trigger) => trigger.type === 'customEvent').length;
  const conversionsWithoutTag = conversions.filter((action) => action.active && !resemblesTag(action, snapshot.tags));

  if (pausedConversions.length) {
    findings.push({
      id: 'gtm:paused-conversion-candidate',
      severity: 'CRITICAL',
      evidenceKind: 'HYPOTHESIS',
      title: `${pausedConversions.length} tag${pausedConversions.length === 1 ? '' : 's'} de possível conversão pausada${pausedConversions.length === 1 ? '' : 's'}`,
      detail: `Os nomes ou tipos sugerem conversão: ${pausedConversions.slice(0, 3).map((tag) => tag.name || tag.id).join(', ')}. Confirme a função antes de reativar.`,
      source: 'GOOGLE_TAG_MANAGER',
    });
  }
  if (!conversionCandidates.length) {
    findings.push({
      id: 'gtm:no-conversion-candidate',
      severity: 'WARNING',
      evidenceKind: 'HYPOTHESIS',
      title: 'Nenhuma tag de conversão foi identificada pelo nome',
      detail: 'Isso pode ser normal se a conversão vier de uma integração, de uma tag com nome diferente ou de importação. Compare com as ações do Google Ads.',
      source: 'GOOGLE_TAG_MANAGER',
    });
  }
  if (noTrigger.length) {
    findings.push({
      id: 'gtm:tags-without-trigger',
      severity: 'WARNING',
      evidenceKind: 'FACT',
      title: `${noTrigger.length} tag${noTrigger.length === 1 ? '' : 's'} ativa${noTrigger.length === 1 ? '' : 's'} sem acionador de disparo`,
      detail: `Tags: ${noTrigger.slice(0, 3).map((tag) => tag.name || tag.id).join(', ')}. Revise a configuração no GTM.`,
      source: 'GOOGLE_TAG_MANAGER',
    });
  }
  if (paused.length && !pausedConversions.length) {
    findings.push({
      id: 'gtm:paused-tags',
      severity: 'INFO',
      evidenceKind: 'FACT',
      title: `${paused.length} tag${paused.length === 1 ? '' : 's'} pausada${paused.length === 1 ? '' : 's'}`,
      detail: `Tags: ${paused.slice(0, 3).map((tag) => tag.name || tag.id).join(', ')}. Nem toda tag pausada é um problema.`,
      source: 'GOOGLE_TAG_MANAGER',
    });
  }
  if (pagesWithoutGoogleTag) {
    findings.push({
      id: 'site:pages-without-google-tag',
      severity: 'WARNING',
      evidenceKind: 'HYPOTHESIS',
      title: `${pagesWithoutGoogleTag} página${pagesWithoutGoogleTag === 1 ? '' : 's'} de anúncio sem Google tag detectada`,
      detail: 'A leitura vê apenas o HTML inicial; tags carregadas depois por JavaScript podem não aparecer. Confirme com o Tag Assistant antes de concluir que há falha.',
      source: 'SITE',
    });
  }
  if (conversionsWithoutTag.length) {
    findings.push({
      id: 'ads:conversion-without-matching-tag',
      severity: 'INFO',
      evidenceKind: 'HYPOTHESIS',
      title: `${conversionsWithoutTag.length} ação${conversionsWithoutTag.length === 1 ? '' : 'ões'} de conversão sem tag de nome parecido`,
      detail: `Ações: ${conversionsWithoutTag.slice(0, 3).map((action) => action.name).join(', ')}. A associação por nome é aproximada; a ação pode vir de importação, integração ou uma tag com nome diferente.`,
      source: 'GOOGLE_ADS',
    });
  }

  return {
    findings: findings.sort((a, b) => ({ CRITICAL: 0, WARNING: 1, INFO: 2 })[a.severity] - ({ CRITICAL: 0, WARNING: 1, INFO: 2 })[b.severity]),
    pagesPendingAudit: pages.filter((page) => page.trackingTags === null).length,
    pagesWithoutGoogleTag,
    tagsWithConsent,
    customEventTriggers,
    conversionActionsWithoutTag: conversionsWithoutTag.length,
  };
}
