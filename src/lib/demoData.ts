import type { DemoStore, WizardState } from './types';

export const emptyWizardState = (): WizardState => ({
  name: '',
  document: '',
  address: {
    cep: '',
    street: '',
    number: '',
    city: '',
    state: '',
  },
  owner: {
    name: '',
    email: '',
  },
});

export const seedStore: DemoStore = {
  id: 'store-1',
  name: 'Loja Seed',
  document: '12345678000199',
  address: {
    cep: '05590100',
    street: 'Rua Demo',
    number: '12',
    city: 'São Paulo',
    state: 'SP',
  },
  owner: {
    name: 'Maria Demo',
    email: 'maria@example.com',
  },
  status: 'active',
};
