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
  name: 'Solar Rift Watcher',
  document: 'SRW-042',
  address: {
    cep: 'NOAA / SWPC',
    street: 'solar_wind_speed',
    number: '600',
    city: '5 min',
    state: 'ELEVATED',
  },
  owner: {
    name: 'Emitir alerta de estacao',
    email: 'bridge-console',
  },
  status: 'active',
};
