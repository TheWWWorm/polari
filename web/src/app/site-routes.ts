import { Routes } from '@angular/router';
import { pageTitle } from './core/site';

/** Pages only this wiki has; the engine adds them to its routes. */
export const SITE_ROUTES: Routes = [
  {
    path: 'stratemy-igra',
    title: pageTitle('Сыграть в стратемы'),
    loadComponent: () => import('./pages/stratemy/stratemy-page').then((m) => m.StratemyPage),
  },
];
