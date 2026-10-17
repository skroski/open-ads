import rawJourney from './onboarding-journey.json';
import type { OpenHelpJourney } from './open-help';

export interface HelpJourney extends OpenHelpJourney {
  route: string;
}

interface RawHelpJourney extends Omit<OpenHelpJourney, 'language'> {
  route: string;
}

interface RawHelpJourneyCatalog {
  language: string;
  journeys: readonly RawHelpJourney[];
}

const catalog = rawJourney as unknown as RawHelpJourneyCatalog;

export const HELP_JOURNEYS: readonly HelpJourney[] = catalog.journeys.map((journey) => ({ ...journey, language: catalog.language }));

export function journeyForUrl(url: string): HelpJourney {
  const route = url.split(/[?#]/, 1)[0].replace(/^\//, '') || 'visao-geral';
  return HELP_JOURNEYS.find((journey) => journey.route === route) ?? HELP_JOURNEYS[0];
}
