import type { DemoContact, Session } from './types';

const SESSION_KEY = 'dash_svelte_demo_session';
const CONTACTS_KEY = 'dash_svelte_demo_contacts';
const FLASH_KEY = 'dash_svelte_demo_flash';

export const storageKeys = {
  session: SESSION_KEY,
  contacts: CONTACTS_KEY,
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

export function readContacts(): DemoContact[] {
  const raw = localStorage.getItem(CONTACTS_KEY);
  if (!raw) return [];
  try {
    const contacts = JSON.parse(raw) as DemoContact[];
    return Array.isArray(contacts) ? contacts : [];
  } catch {
    return [];
  }
}

export function writeContacts(contacts: DemoContact[]): void {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

export function upsertContact(contact: DemoContact): void {
  const contacts = readContacts();
  const index = contacts.findIndex((item) => item.id === contact.id);
  if (index >= 0) {
    contacts[index] = contact;
  } else {
    contacts.push(contact);
  }
  writeContacts(contacts);
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
  localStorage.removeItem(CONTACTS_KEY);
  localStorage.removeItem(FLASH_KEY);
}

export function nextContactId(): string {
  return `contact-${readContacts().length + 1}`;
}

export function getContactById(id: string): DemoContact | undefined {
  return readContacts().find((contact) => contact.id === id);
}
