import { describe, expect, it } from 'vitest';
import { analyzeTracking, diffTrackingSnapshots, TrackingSnapshot } from './tracking-health';

const snapshot = (tags: TrackingSnapshot['tags']): TrackingSnapshot => ({
  workspacePath: 'accounts/1/containers/2/workspaces/3',
  tags,
  triggers: [{ id: 't', name: 'Evento', type: 'customEvent' }],
  variables: [],
});

describe('saúde do rastreamento', () => {
  it('separa fatos de hipóteses para evitar concluir que uma tag é de conversão apenas pelo nome', () => {
    const report = analyzeTracking(
      snapshot([
        { id: '1', name: 'Conversão WhatsApp', type: 'html', paused: true, firingTriggerIds: ['2'], consentStatus: 'NEEDED' },
        { id: '2', name: 'Tag sem gatilho', type: 'html', paused: false, firingTriggerIds: [], consentStatus: 'NOT_SET' },
      ]),
      [{ url: 'https://site.test', readable: true, trackingTags: [] }],
      [{ id: 'ads-1', name: 'Conversão Formulário', active: true }],
    );

    expect(report.tagsWithConsent).toBe(1);
    expect(report.customEventTriggers).toBe(1);
    expect(report.findings.map((finding) => [finding.id, finding.evidenceKind])).toEqual(
      expect.arrayContaining([
        ['gtm:paused-conversion-candidate', 'HYPOTHESIS'],
        ['gtm:tags-without-trigger', 'FACT'],
        ['site:pages-without-google-tag', 'HYPOTHESIS'],
        ['ads:conversion-without-matching-tag', 'HYPOTHESIS'],
      ]),
    );
  });

  it('compara somente o resumo sanitizado das tags', () => {
    const before = snapshot([{ id: '1', name: 'GA4', type: 'gaawc', paused: false, firingTriggerIds: ['1'], consentStatus: 'NOT_SET' }]);
    const after = snapshot([
      { id: '1', name: 'GA4', type: 'gaawc', paused: true, firingTriggerIds: ['1'], consentStatus: 'NOT_SET' },
      { id: '2', name: 'Nova', type: 'html', paused: false, firingTriggerIds: ['2'], consentStatus: 'NOT_NEEDED' },
    ]);
    const diff = diffTrackingSnapshots(before, after);

    expect(diff.changed).toBe(true);
    expect(diff.addedTags).toHaveLength(1);
    expect(diff.changedTags).toHaveLength(1);
    expect(diff.changedTags[0].before.paused).toBe(false);
    expect(diff.changedTags[0].after.paused).toBe(true);
  });
});
