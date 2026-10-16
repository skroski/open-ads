import { LOCALE_ID, ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import localePt from '@angular/common/locales/pt';
import { routes } from './app.routes';
import { accessTokenInterceptor } from './core/access-token';
import { managerIdInterceptor } from './core/manager-ids';

// Formatação brasileira nos pipes (R$ 1.234,56 e 12,5%).
registerLocaleData(localePt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([accessTokenInterceptor, managerIdInterceptor])),
    provideRouter(routes, withComponentInputBinding()),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],
};
