import type { DemoContact, ContactWizardState } from './types';

export const emptyWizardState = (): ContactWizardState => ({
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

export const seedContact: DemoContact = {
  id: 'contact-1',
  name: 'Contato Seed',
  document: '12345678000199',
  address: {
    cep: '11111111',
    street: 'Rua Fictícia',
    number: '12',
    city: 'Cidade Demo',
    state: 'SP',
  },
  owner: {
    name: 'Maria Demo',
    email: 'maria@example.com',
  },
  status: 'active',
};
