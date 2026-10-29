import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { NavigationEnd, Router, provideRouter, withComponentInputBinding, withHashLocation, withNavigationErrorHandler } from '@angular/router';
import { routes } from './app.routes';
import { WikiData } from './core/wiki-data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    // Hash URLs (#/slug) keep the site working on any static host and match the article link format.
    provideRouter(routes, withHashLocation(), withComponentInputBinding(),
      // after a redeploy an open tab may ask for page chunks that no longer exist: reload into the new build
      withNavigationErrorHandler((e) => { if (/dynamically imported module|Loading chunk/.test(String(e.error))) location.reload(); })),
    provideAppInitializer(() => inject(WikiData).load()),
    // a new page starts at the top, except a link to a section (/slug/anchor): the article scrolls
    // there itself, and a scroll to the top first would make the page jump up and back down
    provideAppInitializer(() => {
      const router = inject(Router);
      router.events.subscribe((e) => {
        if (!(e instanceof NavigationEnd)) return;
        let r = router.routerState.snapshot.root;
        while (r.firstChild) r = r.firstChild;
        if (!r.paramMap.has('anchor')) window.scrollTo(0, 0);
      });
    }),
  ],
};
