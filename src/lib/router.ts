import type { Route } from './types';

export function getRouteFromHash(hash: string): Route {
  const value = hash.replace(/^#/, '') || '/login';
  const parts = value.split('/').filter(Boolean);

  if (parts.length === 1 && parts[0] === 'login') return { name: 'login' };
  if (parts.length === 1 && parts[0] === 'dashboard') return { name: 'dashboard' };
  if (parts.length === 2 && parts[0] === 'stores' && parts[1] === 'new') return { name: 'store-new' };
  if (parts.length === 2 && parts[0] === 'stores' && parts[1]) return { name: 'store-detail', id: parts[1] };
  if (parts.length === 3 && parts[0] === 'stores' && parts[2] === 'edit-address') {
    return { name: 'store-edit-address', id: parts[1] };
  }

  return { name: 'unknown' };
}

export function toHash(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}
