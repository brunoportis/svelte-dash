export type DemoStore = {
  id: string;
  name: string;
  document: string;
  address: {
    cep: string;
    street: string;
    number: string;
    city: string;
    state: string;
  };
  owner: {
    name: string;
    email: string;
  };
  status: 'draft' | 'active';
};

export type Session = {
  email: string;
};

export type WizardState = {
  name: string;
  document: string;
  address: {
    cep: string;
    street: string;
    number: string;
    city: string;
    state: string;
  };
  owner: {
    name: string;
    email: string;
  };
};

export type Route =
  | { name: 'login' }
  | { name: 'dashboard' }
  | { name: 'store-new' }
  | { name: 'store-detail'; id: string }
  | { name: 'store-edit-address'; id: string }
  | { name: 'unknown' };
