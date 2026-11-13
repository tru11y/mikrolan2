import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDropBreadcrumb } from './sentryScrub.ts';

test('breadcrumbs d’interaction supprimés (touch, clic, défilement, saisie, type user)', () => {
  for (const category of ['touch', 'gesture', 'ui.click', 'ui.scroll', 'ui.input']) {
    assert.equal(shouldDropBreadcrumb({ category }), true, category);
  }
  assert.equal(shouldDropBreadcrumb({ category: 'touch', type: 'user' }), true);
  assert.equal(shouldDropBreadcrumb({ type: 'user' }), true);
});

test('breadcrumbs utiles conservés (cycle de vie, écrans, réseau, console nettoyée ailleurs)', () => {
  for (const category of ['app.lifecycle', 'ui.lifecycle', 'xhr', 'fetch', 'network', 'navigation', 'sentry.event']) {
    assert.equal(shouldDropBreadcrumb({ category }), false, category);
  }
});
