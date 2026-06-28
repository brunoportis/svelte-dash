import type { DemoStore, Session } from './types';

const SESSION_KEY = 'dash_svelte_demo_session';
const STORES_KEY = 'dash_svelte_demo_stores';
const FLASH_KEY = 'dash_svelte_demo_flash';

export const storageKeys = {
  session: SESSION_KEY,
  stores: STORES_KEY,
  flash: FLASH_KEY,
} as const;

export function readSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function readStores(): DemoStore[] {
  const raw = localStorage.getItem(STORES_KEY);
  if (!raw) return [];
  try {
    const stores = JSON.parse(raw) as DemoStore[];
    return Array.isArray(stores) ? stores : [];
  } catch {
    return [];
  }
}

export function writeStores(stores: DemoStore[]): void {
  localStorage.setItem(STORES_KEY, JSON.stringify(stores));
}

export function upsertStore(store: DemoStore): void {
  const stores = readStores();
  const index = stores.findIndex((item) => item.id === store.id);
  if (index >= 0) {
    stores[index] = store;
  } else {
    stores.push(store);
  }
  writeStores(stores);
}

export function readFlash(): string {
  return localStorage.getItem(FLASH_KEY) ?? '';
}

export function setFlash(message: string): void {
  localStorage.setItem(FLASH_KEY, message);
}

export function consumeFlash(): string {
  const message = readFlash();
  localStorage.removeItem(FLASH_KEY);
  return message;
}

export function clearDemoData(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(STORES_KEY);
  localStorage.removeItem(FLASH_KEY);
}

export function nextStoreId(): string {
  return `store-${readStores().length + 1}`;
}

export function getStoreById(id: string): DemoStore | undefined {
  return readStores().find((store) => store.id === id);
}
