export type DemoContact = {
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

export type ContactWizardState = {
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
  | { name: 'contact-new' }
  | { name: 'contact-detail'; id: string }
  | { name: 'contact-edit-address'; id: string }
  | { name: 'unknown' };
