import { Routes } from '@angular/router';
import { sectionTitle } from './core/site';

/** Pages only this wiki has; the engine adds them to its routes. */
export const SITE_ROUTES: Routes = [
  {
    path: 'stratemy-igra',
    title: sectionTitle('stratemy-igra'),
    loadComponent: () => import('./pages/stratemy/stratemy-page').then((m) => m.StratemyPage),
  },
];
