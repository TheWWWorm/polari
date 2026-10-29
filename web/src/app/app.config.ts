import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withHashLocation, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { routes } from './app.routes';
import { WikiData } from './core/wiki-data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    // Hash URLs (#/slug) keep the site working on any static host and match the article link format.
    provideRouter(routes, withHashLocation(), withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // after a redeploy an open tab may ask for page chunks that no longer exist: reload into the new build
      withNavigationErrorHandler((e) => { if (/dynamically imported module|Loading chunk/.test(String(e.error))) location.reload(); })),
    provideAppInitializer(() => inject(WikiData).load()),
  ],
};
