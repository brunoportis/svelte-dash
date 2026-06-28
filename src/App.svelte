<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { emptyWizardState, seedStore } from './lib/demoData';
  import { getRouteFromHash, toHash } from './lib/router';
  import {
    clearDemoData,
    getStoreById,
    nextStoreId,
    readSession,
    readFlash,
    readStores,
    setFlash,
    upsertStore,
    writeSession,
    writeStores,
  } from './lib/storage';
  import type { DemoStore, Route } from './lib/types';

  const steps = ['basic', 'address', 'owner', 'review'] as const;
  type Step = (typeof steps)[number];

  let route: Route = { name: 'unknown' };
  let loggedIn = false;
  let stores: DemoStore[] = [];
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
  let currentStore: DemoStore | undefined;
  let loginError = '';
  let wizardError = '';

  function syncState() {
    route = getRouteFromHash(window.location.hash);
    const session = readSession();
    loggedIn = Boolean(session);
    stores = readStores();
    flashMessage = readFlash();
    currentStore = route.name === 'store-detail' || route.name === 'store-edit-address'
      ? getStoreById(route.id)
      : undefined;

    if (route.name === 'store-edit-address' && currentStore) {
      editAddress = { ...currentStore.address };
    }

    if (route.name !== 'store-new') {
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

  function resetDemoData() {
    clearDemoData();
    loggedIn = false;
    stores = [];
    setFlash('Dados de demonstração resetados');
    navigate('/login');
    syncState();
  }

  function seedDemoStore() {
    const existing = readStores();
    if (existing.length === 0) {
      writeStores([seedStore]);
      setFlash('Loja seed criada');
    }
    syncState();
  }

  function startWizard() {
    wizard = emptyWizardState();
    wizardStep = 'basic';
    wizardError = '';
    navigate('/stores/new');
  }

  function nextStep() {
    wizardError = '';
    if (wizardStep === 'basic' && (!wizard.name.trim() || !wizard.document.trim())) {
      wizardError = 'Preencha os dados da loja';
      return;
    }
    if (wizardStep === 'address' && (!wizard.address.cep.trim() || !wizard.address.street.trim())) {
      wizardError = 'Preencha o endereço';
      return;
    }
    if (wizardStep === 'owner' && (!wizard.owner.name.trim() || !wizard.owner.email.trim())) {
      wizardError = 'Preencha o responsável';
      return;
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
    const id = nextStoreId();
    const store: DemoStore = {
      id,
      name: wizard.name,
      document: wizard.document,
      address: { ...wizard.address },
      owner: { ...wizard.owner },
      status: 'active',
    };

    upsertStore(store);
    setFlash('Loja cadastrada com sucesso');
    navigate(`/stores/${id}`);
    syncState();
  }

  function saveAddress() {
    if (!currentStore) return;
    const updated: DemoStore = {
      ...currentStore,
      address: { ...editAddress },
    };
    upsertStore(updated);
    setFlash('Endereço atualizado com sucesso');
    navigate(`/stores/${currentStore.id}`);
    syncState();
  }

  function cancelAddress() {
    if (currentStore) {
      navigate(`/stores/${currentStore.id}`);
    } else {
      navigate('/dashboard');
    }
  }

  onMount(() => {
    if (!window.location.hash) {
      window.location.hash = toHash('/login');
    }

    syncState();
    ensureAuth();
    window.addEventListener('hashchange', handleHashChange);
  });

  onDestroy(() => {
    window.removeEventListener('hashchange', handleHashChange);
  });

  $: if (route.name === 'unknown') {
    navigate('/login');
  }

  $: if (!loggedIn && route.name !== 'login') {
    ensureAuth();
  }
</script>

{#if flashMessage}
  <div class="flash" data-testid="flash-message" role="status">{flashMessage}</div>
{/if}

{#if route.name === 'login'}
  <main class="shell" data-testid="login-page">
    <section class="panel narrow">
      <h1>QAPlanner Demo App</h1>
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
        <p>Lojas cadastradas: {stores.length}</p>
      </div>
      <div class="actions">
        <button data-testid="start-store-wizard" on:click={startWizard}>Cadastrar loja</button>
        <button data-testid="seed-demo-store" on:click={seedDemoStore}>Seed demo store</button>
        <button data-testid="reset-demo-data" on:click={resetDemoData}>Reset demo data</button>
      </div>
    </section>

    <section class="panel">
      <h2>Lista de lojas</h2>
      <div data-testid="store-list" class="list">
        {#if stores.length === 0}
          <p class="muted">Nenhuma loja cadastrada.</p>
        {:else}
          {#each stores as store}
            <a data-testid="store-list-item" class="list-item" href={toHash(`/stores/${store.id}`)}>
              <strong>{store.name}</strong>
              <span>{store.document}</span>
            </a>
          {/each}
        {/if}
      </div>
    </section>
  </main>
{:else if route.name === 'store-new'}
  <main class="shell" data-testid="wizard-page">
    <section class="panel narrow">
      <h1>Cadastrar loja</h1>

      {#if wizardStep === 'basic'}
        <div data-testid="wizard-step-basic">
          <h2>Etapa 1: Dados da loja</h2>
          <label>
            Nome da loja
            <input data-testid="store-name" bind:value={wizard.name} />
          </label>
          <label>
            CNPJ
            <input data-testid="store-document" bind:value={wizard.document} />
          </label>
        </div>
      {:else if wizardStep === 'address'}
        <div data-testid="wizard-step-address">
          <h2>Etapa 2: Endereço</h2>
          <label>CEP <input data-testid="store-cep" bind:value={wizard.address.cep} /></label>
          <label>Rua <input data-testid="store-street" bind:value={wizard.address.street} /></label>
          <label>Número <input data-testid="store-number" bind:value={wizard.address.number} /></label>
          <label>Cidade <input data-testid="store-city" bind:value={wizard.address.city} /></label>
          <label>Estado <input data-testid="store-state" bind:value={wizard.address.state} /></label>
        </div>
      {:else if wizardStep === 'owner'}
        <div data-testid="wizard-step-owner">
          <h2>Etapa 3: Responsável</h2>
          <label>
            Nome do responsável
            <input data-testid="owner-name" bind:value={wizard.owner.name} />
          </label>
          <label>
            Email do responsável
            <input data-testid="owner-email" type="email" bind:value={wizard.owner.email} />
          </label>
        </div>
      {:else}
        <div data-testid="wizard-step-review">
          <h2>Etapa 4: Revisão</h2>
          <p data-testid="review-store-name"><strong>Nome:</strong> {wizard.name}</p>
          <p data-testid="review-store-document"><strong>CNPJ:</strong> {wizard.document}</p>
          <p data-testid="review-store-address">
            <strong>Endereço:</strong> {wizard.address.street}, {wizard.address.number} - {wizard.address.city}/{wizard.address.state} - {wizard.address.cep}
          </p>
          <p data-testid="review-store-owner">
            <strong>Responsável:</strong> {wizard.owner.name} ({wizard.owner.email})
          </p>
        </div>
      {/if}

      <p class="error">{wizardError}</p>
      <div class="actions">
        {#if wizardStep !== 'basic'}
          <button data-testid="wizard-back" type="button" on:click={backStep}>Voltar</button>
        {/if}
        {#if wizardStep !== 'review'}
          <button data-testid="wizard-next" type="button" on:click={nextStep}>Próximo</button>
        {:else}
          <button data-testid="wizard-finish" type="button" on:click={finishWizard}>Finalizar cadastro</button>
        {/if}
      </div>
    </section>
  </main>
{:else if route.name === 'store-detail'}
  <main class="shell" data-testid="store-detail-page">
    {#if currentStore}
      <section class="panel narrow">
        <h1>Loja cadastrada com sucesso</h1>
        <p data-testid="store-detail-status">Status: {currentStore.status}</p>
        <p data-testid="store-detail-name"><strong>Nome:</strong> {currentStore.name}</p>
        <p data-testid="store-detail-document"><strong>CNPJ:</strong> {currentStore.document}</p>
        <p data-testid="store-detail-address">
          <strong>Endereço:</strong> {currentStore.address.street}, {currentStore.address.number} - {currentStore.address.city}/{currentStore.address.state} - {currentStore.address.cep}
        </p>
        <p data-testid="store-detail-owner">
          <strong>Responsável:</strong> {currentStore.owner.name} ({currentStore.owner.email})
        </p>
        <div class="actions">
          <button data-testid="edit-address" type="button" on:click={() => navigate(`/stores/${currentStore.id}/edit-address`)}>
            Editar endereço
          </button>
          <button data-testid="back-to-dashboard" type="button" on:click={() => navigate('/dashboard')}>
            Voltar ao dashboard
          </button>
        </div>
      </section>
    {:else}
      <section class="panel narrow">
        <h1>Loja não encontrada</h1>
        <button type="button" on:click={() => navigate('/dashboard')}>Voltar ao dashboard</button>
      </section>
    {/if}
  </main>
{:else if route.name === 'store-edit-address'}
  <main class="shell" data-testid="edit-address-page">
    {#if currentStore}
      <section class="panel narrow">
        <h1>Editar endereço</h1>
        <label>CEP <input data-testid="edit-store-cep" bind:value={editAddress.cep} /></label>
        <label>Rua <input data-testid="edit-store-street" bind:value={editAddress.street} /></label>
        <label>Número <input data-testid="edit-store-number" bind:value={editAddress.number} /></label>
        <label>Cidade <input data-testid="edit-store-city" bind:value={editAddress.city} /></label>
        <label>Estado <input data-testid="edit-store-state" bind:value={editAddress.state} /></label>
        <div class="actions">
          <button data-testid="cancel-address" type="button" on:click={cancelAddress}>Cancelar</button>
          <button data-testid="save-address" type="button" on:click={saveAddress}>Salvar endereço</button>
        </div>
      </section>
    {:else}
      <section class="panel narrow">
        <h1>Loja não encontrada</h1>
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
    .page-header {
      flex-direction: column;
    }
  }
</style>
