<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Select } from 'bits-ui';
  import { emptyWizardState, seedContact } from './lib/demoData';
  import { getRouteFromHash, toHash } from './lib/router';
  import {
    clearDemoData,
    clearSession,
    getContactById,
    nextContactId,
    readContacts,
    readFlash,
    readSession,
    setFlash,
    upsertContact,
    writeContacts,
    writeSession,
  } from './lib/storage';
  import type { DemoContact, Route } from './lib/types';

  const steps = ['basic', 'address', 'owner', 'review'] as const;
  const states = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
  const stateItems = states.map((state) => ({ value: state, label: state }));
  type Step = (typeof steps)[number];

  let route: Route = { name: 'unknown' };
  let loggedIn = false;
  let sessionEmail = '';
  let contacts: DemoContact[] = [];
  let flashMessage = '';
  let wizardStep: Step = 'basic';
  let wizard = emptyWizardState();
  let editAddress = {
    cep: '',
    street: '',
    number: '',
    city: '',
    state: '',
  };
  let currentContact: DemoContact | undefined;
  let loginError = '';
  let wizardError = '';
  let editAddressError = '';
  let initialized = false;

  function onlyDigits(value: string): string {
    return value.replace(/\D/g, '').slice(0, 8);
  }

  function formatCep(value: string): string {
    const digits = onlyDigits(value);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  function autoFillFromCep(value: string) {
    const digits = onlyDigits(value);
    if (!digits) {
      return {
        cep: '',
        street: '',
        number: '',
        city: '',
        state: '',
      };
    }

    const padded = digits.padEnd(8, '0');
    const numeric = Number.parseInt(padded, 10);
    const state = states[numeric % states.length];

    return {
      cep: formatCep(digits),
      street: `Rua ${digits.slice(0, 4) || 'Demo'}`,
      number: String((numeric % 9000) + 1),
      city: `Cidade ${digits.slice(-3) || 'Demo'}`,
      state,
    };
  }

  function setWizardCep(value: string) {
    wizard = {
      ...wizard,
      address: {
        ...wizard.address,
        ...autoFillFromCep(value),
      },
    };
  }

  function setEditCep(value: string) {
    editAddress = {
      ...editAddress,
      ...autoFillFromCep(value),
    };
  }

  function handleWizardCepInput(event: Event) {
    setWizardCep((event.currentTarget as HTMLInputElement).value);
  }

  function handleEditCepInput(event: Event) {
    setEditCep((event.currentTarget as HTMLInputElement).value);
  }

  function syncState() {
    route = getRouteFromHash(window.location.hash);
    const session = readSession();
    loggedIn = Boolean(session);
    sessionEmail = session?.email ?? '';
    contacts = readContacts();
    flashMessage = readFlash();
    currentContact = route.name === 'contact-detail' || route.name === 'contact-edit-address'
      ? getContactById(route.id)
      : undefined;

    if (route.name === 'contact-edit-address' && currentContact) {
      editAddress = { ...currentContact.address };
      editAddressError = '';
    }

    if (route.name !== 'contact-new') {
      wizard = emptyWizardState();
      wizardStep = 'basic';
      wizardError = '';
    }
  }

  function navigate(path: string) {
    window.location.hash = toHash(path);
  }

  function ensureAuth() {
    if (!loggedIn && route.name !== 'login') {
      navigate('/login');
      return false;
    }
    return true;
  }

  function handleHashChange() {
    syncState();
    ensureAuth();
  }

  function handleLoginSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '').trim();

    if (!email || !password) {
      loginError = 'Informe email e senha';
      return;
    }

    loginError = '';
    writeSession({ email });
    syncState();
    navigate('/dashboard');
  }

  function logout() {
    clearSession();
    loggedIn = false;
    sessionEmail = '';
    navigate('/login');
    syncState();
  }

  function resetDemoData() {
    clearDemoData();
    loggedIn = false;
    sessionEmail = '';
    contacts = [];
    setFlash('Dados de demonstração resetados');
    navigate('/login');
    syncState();
  }

  function seedDemoContact() {
    const existing = readContacts();
    if (existing.length === 0) {
      writeContacts([seedContact]);
      setFlash('Contato seed criado');
    }
    syncState();
  }

  function startWizard() {
    wizard = emptyWizardState();
    wizardStep = 'basic';
    wizardError = '';
    navigate('/contacts/new');
  }

  function nextStep() {
    wizardError = '';
    if (wizardStep === 'basic') {
      if (!wizard.name.trim() || !wizard.document.trim()) {
        wizardError = 'Preencha nome e documento';
        return;
      }
    }

    if (wizardStep === 'address') {
      if (!wizard.address.cep.trim() || !wizard.address.street.trim() || !wizard.address.number.trim()) {
        wizardError = 'Preencha CEP e endereço';
        return;
      }
    }

    if (wizardStep === 'owner') {
      if (!wizard.owner.name.trim() || !wizard.owner.email.trim()) {
        wizardError = 'Preencha nome e email do responsável';
        return;
      }
    }

    const index = steps.indexOf(wizardStep);
    if (index < steps.length - 1) {
      wizardStep = steps[index + 1];
    }
  }

  function backStep() {
    wizardError = '';
    const index = steps.indexOf(wizardStep);
    if (index > 0) {
      wizardStep = steps[index - 1];
    } else {
      navigate('/dashboard');
    }
  }

  function finishWizard() {
    if (!wizard.name.trim() || !wizard.document.trim()) {
      wizardError = 'Preencha nome e documento';
      return;
    }
    if (!wizard.address.cep.trim() || !wizard.address.street.trim() || !wizard.address.number.trim()) {
      wizardError = 'Preencha CEP e endereço';
      return;
    }
    if (!wizard.owner.name.trim() || !wizard.owner.email.trim()) {
      wizardError = 'Preencha nome e email do responsável';
      return;
    }

    const id = nextContactId();
    const contact: DemoContact = {
      id,
      name: wizard.name,
      document: wizard.document,
      address: { ...wizard.address },
      owner: { ...wizard.owner },
      status: 'active',
    };

    upsertContact(contact);
    setFlash('Contato cadastrado com sucesso');
    navigate(`/contacts/${id}`);
    syncState();
  }

  function saveAddress() {
    if (!currentContact) return;

    if (!editAddress.cep.trim() || !editAddress.street.trim() || !editAddress.number.trim()) {
      editAddressError = 'CEP, rua e número são obrigatórios';
      return;
    }

    editAddressError = '';
    const updated: DemoContact = {
      ...currentContact,
      address: { ...editAddress },
    };
    upsertContact(updated);
    setFlash('Endereço atualizado com sucesso');
    navigate(`/contacts/${currentContact.id}`);
    syncState();
  }

  function cancelAddress() {
    if (currentContact) {
      navigate(`/contacts/${currentContact.id}`);
    } else {
      navigate('/dashboard');
    }
  }

  onMount(() => {
    if (!window.location.hash) {
      window.location.hash = toHash('/login');
    }

    syncState();
    initialized = true;
    ensureAuth();
    window.addEventListener('hashchange', handleHashChange);
  });

  onDestroy(() => {
    window.removeEventListener('hashchange', handleHashChange);
  });

  $: if (initialized && route.name === 'unknown') {
    navigate('/login');
  }

  $: if (initialized && !loggedIn && route.name !== 'login') {
    ensureAuth();
  }
</script>

{#if flashMessage}
  <div class="flash" data-testid="flash-message" role="status">{flashMessage}</div>
{/if}

{#if route.name === 'login'}
  <main class="shell" data-testid="login-page">
    <section class="panel narrow">
      <h1>dash-svelte</h1>
      <form on:submit={handleLoginSubmit}>
        <label>
          Email
          <input data-testid="login-email" name="email" type="email" autocomplete="email" />
        </label>
        <label>
          Senha
          <input data-testid="login-password" name="password" type="password" autocomplete="current-password" />
        </label>
        <p class="error" data-testid="login-error">{loginError}</p>
        <button data-testid="login-submit" type="submit">Entrar</button>
      </form>
    </section>
  </main>
{:else if route.name === 'dashboard'}
  <main class="shell" data-testid="dashboard-page">
    <section class="page-header">
      <div>
        <h1>Bem-vindo</h1>
        <p>Contatos cadastrados: {contacts.length}</p>
        <p class="muted">Logado como: {sessionEmail}</p>
      </div>
      <div class="actions">
        <button data-testid="start-contact-wizard" on:click={startWizard}>Cadastrar contato</button>
        <button data-testid="seed-demo-contact" on:click={seedDemoContact}>Seed contato demo</button>
        <button data-testid="reset-demo-data" on:click={resetDemoData}>Reset demo data</button>
        <button data-testid="logout" on:click={logout}>Sair</button>
      </div>
    </section>

    <section class="panel">
      <h2>Lista de contatos</h2>
      <div data-testid="contact-list" class="list">
        {#if contacts.length === 0}
          <p class="muted">Nenhum contato cadastrado.</p>
        {:else}
          {#each contacts as contact}
            <a data-testid="contact-list-item" class="list-item" href={toHash(`/contacts/${contact.id}`)}>
              <strong>{contact.name}</strong>
              <span>{contact.document}</span>
            </a>
          {/each}
        {/if}
      </div>
    </section>
  </main>
{:else if route.name === 'contact-new'}
  <main class="shell" data-testid="contact-wizard-page">
    <section class="panel narrow">
      <div class="panel-header">
        <h1>Cadastrar contato</h1>
        <p class="muted">Logado como: {sessionEmail}</p>
      </div>

      {#if wizardStep === 'basic'}
        <div data-testid="contact-wizard-step-basic">
          <h2>Etapa 1: Dados do contato</h2>
          <label>
            Nome do contato
            <input data-testid="contact-name" bind:value={wizard.name} />
          </label>
          <label>
            Documento
            <input data-testid="contact-document" bind:value={wizard.document} />
          </label>
        </div>
      {:else if wizardStep === 'address'}
        <div data-testid="contact-wizard-step-address">
          <h2>Etapa 2: Endereço</h2>
        <label>
          CEP
          <input
            data-testid="contact-cep"
            value={wizard.address.cep}
            on:input={handleWizardCepInput}
          />
        </label>
        <label>Rua <input data-testid="contact-street" bind:value={wizard.address.street} /></label>
        <label>Número <input data-testid="contact-number" bind:value={wizard.address.number} /></label>
        <label>Cidade <input data-testid="contact-city" bind:value={wizard.address.city} /></label>
        <label>
          Estado
            <Select.Root type="single" bind:value={wizard.address.state} items={stateItems}>
            <Select.Trigger data-testid="contact-state" class="select-trigger">
              <Select.Value placeholder="Selecione o estado" />
            </Select.Trigger>
            <Select.Content class="select-content">
              <Select.Viewport class="select-viewport">
                {#each states as state}
                  <Select.Item value={state} label={state} class="select-item">
                    {state}
                  </Select.Item>
                {/each}
              </Select.Viewport>
            </Select.Content>
          </Select.Root>
        </label>
        </div>
      {:else if wizardStep === 'owner'}
        <div data-testid="contact-wizard-step-owner">
          <h2>Etapa 3: Responsável</h2>
          <label>
            Nome do responsável
            <input data-testid="contact-owner-name" bind:value={wizard.owner.name} />
          </label>
          <label>
            Email do responsável
            <input data-testid="contact-owner-email" type="email" bind:value={wizard.owner.email} />
          </label>
        </div>
      {:else}
        <div data-testid="contact-wizard-step-review">
          <h2>Etapa 4: Revisão</h2>
          <p data-testid="review-contact-name"><strong>Nome:</strong> {wizard.name}</p>
          <p data-testid="review-contact-document"><strong>Documento:</strong> {wizard.document}</p>
          <p data-testid="review-contact-address">
            <strong>Endereço:</strong> {wizard.address.street}, {wizard.address.number} - {wizard.address.city}/{wizard.address.state} - {wizard.address.cep}
          </p>
          <p data-testid="review-contact-owner">
            <strong>Responsável:</strong> {wizard.owner.name} ({wizard.owner.email})
          </p>
        </div>
      {/if}

      <p class="error" data-testid="wizard-error">{wizardError}</p>
      <div class="actions">
        {#if wizardStep !== 'basic'}
          <button data-testid="contact-wizard-back" type="button" on:click={backStep}>Voltar</button>
        {/if}
        {#if wizardStep !== 'review'}
          <button data-testid="contact-wizard-next" type="button" on:click={nextStep}>Próximo</button>
        {:else}
          <button data-testid="contact-wizard-finish" type="button" on:click={finishWizard}>Finalizar cadastro</button>
        {/if}
      </div>
    </section>
  </main>
{:else if route.name === 'contact-detail'}
  <main class="shell" data-testid="contact-detail-page">
    {#if currentContact}
      <section class="panel narrow">
        <div class="panel-header">
          <h1>Contato cadastrado com sucesso</h1>
          <p class="muted">Logado como: {sessionEmail}</p>
        </div>
        <p data-testid="contact-detail-status">Status: {currentContact.status}</p>
        <p data-testid="contact-detail-name"><strong>Nome:</strong> {currentContact.name}</p>
        <p data-testid="contact-detail-document"><strong>Documento:</strong> {currentContact.document}</p>
        <p data-testid="contact-detail-address">
          <strong>Endereço:</strong> {currentContact.address.street}, {currentContact.address.number} - {currentContact.address.city}/{currentContact.address.state} - {currentContact.address.cep}
        </p>
        <p data-testid="contact-detail-owner">
          <strong>Responsável:</strong> {currentContact.owner.name} ({currentContact.owner.email})
        </p>
        <div class="actions">
          <button data-testid="edit-address" type="button" on:click={() => navigate(`/contacts/${currentContact.id}/edit-address`)}>
            Editar endereço
          </button>
          <button data-testid="back-to-dashboard" type="button" on:click={() => navigate('/dashboard')}>
            Voltar ao dashboard
          </button>
          <button data-testid="logout" type="button" on:click={logout}>Sair</button>
        </div>
      </section>
    {:else}
      <section class="panel narrow">
        <h1>Contato não encontrado</h1>
        <button type="button" on:click={() => navigate('/dashboard')}>Voltar ao dashboard</button>
      </section>
    {/if}
  </main>
{:else if route.name === 'contact-edit-address'}
  <main class="shell" data-testid="contact-edit-address-page">
    {#if currentContact}
      <section class="panel narrow">
        <div class="panel-header">
          <h1>Editar endereço</h1>
          <p class="muted">Logado como: {sessionEmail}</p>
        </div>
        <label>
          CEP
          <input
            data-testid="edit-contact-cep"
            value={editAddress.cep}
            on:input={handleEditCepInput}
          />
        </label>
        <label>Rua <input data-testid="edit-contact-street" bind:value={editAddress.street} /></label>
        <label>Número <input data-testid="edit-contact-number" bind:value={editAddress.number} /></label>
        <label>Cidade <input data-testid="edit-contact-city" bind:value={editAddress.city} /></label>
        <label>
          Estado
          <Select.Root type="single" bind:value={editAddress.state} items={stateItems}>
            <Select.Trigger data-testid="edit-contact-state" class="select-trigger">
              <Select.Value placeholder="Selecione o estado" />
            </Select.Trigger>
            <Select.Content class="select-content">
              <Select.Viewport class="select-viewport">
                {#each states as state}
                  <Select.Item value={state} label={state} class="select-item">
                    {state}
                  </Select.Item>
                {/each}
              </Select.Viewport>
            </Select.Content>
          </Select.Root>
        </label>
        <p class="error" data-testid="edit-address-error">{editAddressError}</p>
        <div class="actions">
          <button data-testid="cancel-address" type="button" on:click={cancelAddress}>Cancelar</button>
          <button data-testid="save-address" type="button" on:click={saveAddress}>Salvar endereço</button>
          <button data-testid="logout" type="button" on:click={logout}>Sair</button>
        </div>
      </section>
    {:else}
      <section class="panel narrow">
        <h1>Contato não encontrado</h1>
        <button type="button" on:click={() => navigate('/dashboard')}>Voltar ao dashboard</button>
      </section>
    {/if}
  </main>
{:else}
  <main class="shell">
    <section class="panel narrow">
      <h1>Redirecionando...</h1>
    </section>
  </main>
{/if}

<style>
  .shell {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 16px 64px;
  }

  .panel {
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 24px;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  }

  .narrow {
    max-width: 560px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 24px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }

  .list {
    display: grid;
    gap: 12px;
  }

  .list-item {
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #f9fafb;
    text-decoration: none;
  }

  form,
  label {
    display: grid;
    gap: 6px;
  }

  form {
    gap: 14px;
  }

  input {
    border: 1px solid #9ca3af;
    border-radius: 6px;
    padding: 10px 12px;
    background: white;
  }

  button {
    border: 1px solid #1f2937;
    border-radius: 6px;
    padding: 10px 14px;
    background: #1f2937;
    color: white;
    cursor: pointer;
  }

  button[type='button']:not(:hover),
  button[type='submit']:not(:hover) {
    opacity: 0.97;
  }

  h1 {
    margin: 0 0 12px;
    font-size: 28px;
  }

  h2 {
    margin: 0 0 16px;
    font-size: 20px;
  }

  p {
    margin: 8px 0;
  }

  .error {
    color: #b91c1c;
    min-height: 1.5em;
  }

  .muted {
    color: #6b7280;
  }

  .flash {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 12px 16px;
    background: #dcfce7;
    color: #166534;
    border-bottom: 1px solid #86efac;
  }

  @media (max-width: 720px) {
    .page-header,
    .panel-header {
      flex-direction: column;
    }
  }
</style>
