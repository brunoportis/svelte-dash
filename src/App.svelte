<script lang="ts">
  import { fly } from 'svelte/transition';
  import { onDestroy, onMount } from 'svelte';
  import { Select } from 'bits-ui';
  import { emptyWizardState, seedContact } from './lib/demoData';
  import { fetchSpaceWeatherSnapshot, type SpaceWeatherSnapshot } from './lib/spaceWeather';
  import { getRouteFromHash, toHash } from './lib/router';
  import {
    clearDemoData,
    clearSession,
    consumeFlash,
    getContactById,
    nextContactId,
    readContacts,
    readSession,
    setFlash,
    upsertContact,
    writeContacts,
    writeSession,
  } from './lib/storage';
  import type { DemoContact, Route } from './lib/types';

  const steps = ['basic', 'address', 'owner', 'review'] as const;
  const states = ['NOMINAL', 'ELEVATED', 'CRITICAL'] as const;
  const stateItems = states.map((state) => ({ value: state, label: state }));
  const navItems = [
    { label: 'Painel', href: '/dashboard', icon: 'grid' },
    { label: 'Sentinels', href: '/contacts/new', icon: 'target' },
    { label: 'Acesso', href: '/login', icon: 'user' },
  ] as const;
  type Step = (typeof steps)[number];
  const stepLabels: Record<Step, string> = {
    basic: 'Identidade',
    address: 'Parametros',
    owner: 'Acionamento',
    review: 'Revisão',
  };

  let route: Route = { name: 'unknown' };
  let loggedIn = false;
  let sessionEmail = '';
  let contacts: DemoContact[] = [];
  let flashMessage = '';
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let flashDismissTimer: ReturnType<typeof setTimeout> | undefined;
  let flashStartedAt = 0;
  let flashRemaining = 4200;
  let flashProgress = 1;
  let flashVisible = false;
  let flashExiting = false;
  let flashProgressFrame: number | undefined;
  let wizardStep: Step = 'basic';
  let wizardDirection: 1 | -1 = 1;
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
  let currentSection = 'Acesso';
  let spaceWeather: SpaceWeatherSnapshot | null = null;
  let spaceWeatherLoading = false;
  let spaceWeatherError = '';
  let spaceWeatherTimer: ReturnType<typeof setInterval> | undefined;

  function getRouteLabel(currentRoute: Route): string {
    switch (currentRoute.name) {
      case 'dashboard':
        return 'Painel';
      case 'contact-new':
        return 'Sentinels';
      case 'contact-detail':
        return 'Sentinels';
      case 'contact-edit-address':
        return 'Sentinels';
      case 'login':
      default:
        return 'Acesso';
    }
  }

  function getSignalPreset(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return {
        cep: '',
        street: '',
        number: '',
        city: '',
        state: '',
      };
    }

    if (normalized.includes('noaa') || normalized.includes('swpc') || normalized.includes('helios')) {
      return {
        cep: value.trim(),
        street: 'solar_wind_speed',
        number: '600',
        city: '5 min',
        state: 'ELEVATED',
      };
    }

    if (normalized.includes('kp') || normalized.includes('geomag')) {
      return {
        cep: value.trim(),
        street: 'planetary_k_index',
        number: '5',
        city: '1 cycle',
        state: 'CRITICAL',
      };
    }

    return {
      cep: value.trim(),
      street: '',
      number: '',
      city: '',
      state: 'NOMINAL',
    };
  }

  function setWizardCep(value: string) {
    const preset = getSignalPreset(value);
    wizard = {
      ...wizard,
      address: {
        ...wizard.address,
        ...preset,
        street: wizard.address.street || preset.street,
        number: wizard.address.number || preset.number,
        city: wizard.address.city || preset.city,
        state: wizard.address.state || preset.state,
      },
    };
  }

  function setEditCep(value: string) {
    const preset = getSignalPreset(value);
    editAddress = {
      ...editAddress,
      ...preset,
      street: editAddress.street || preset.street,
      number: editAddress.number || preset.number,
      city: editAddress.city || preset.city,
      state: editAddress.state || preset.state,
    };
  }

  function handleWizardCepInput(event: Event) {
    setWizardCep((event.currentTarget as HTMLInputElement).value);
  }

  function handleEditCepInput(event: Event) {
    setEditCep((event.currentTarget as HTMLInputElement).value);
  }

  async function loadSpaceWeather() {
    spaceWeatherLoading = true;
    try {
      spaceWeather = await fetchSpaceWeatherSnapshot();
      spaceWeatherError = '';
    } catch {
      spaceWeatherError = 'Malha NOAA indisponível no momento';
    } finally {
      spaceWeatherLoading = false;
    }
  }

  function getSentinelState(contact: DemoContact): string {
    return contact.status === 'active' ? 'armed' : 'draft';
  }

  function getSentinelSubtitle(contact: DemoContact): string {
    return `${contact.address.street} > ${contact.address.number} // ${contact.address.city}`;
  }

  function syncState() {
    route = getRouteFromHash(window.location.hash);
    const session = readSession();
    loggedIn = Boolean(session);
    sessionEmail = session?.email ?? '';
    contacts = readContacts();
    const pendingFlash = consumeFlash();
    if (pendingFlash) showFlash(pendingFlash);
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

  function showFlash(message: string) {
    if (flashTimer) clearTimeout(flashTimer);
    if (flashDismissTimer) clearTimeout(flashDismissTimer);
    if (flashProgressFrame) cancelAnimationFrame(flashProgressFrame);
    flashMessage = message;
    flashVisible = true;
    flashExiting = false;
    flashRemaining = 4200;
    flashProgress = 1;
    startFlashCountdown();
  }

  function dismissFlash() {
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = undefined;
    if (flashProgressFrame) cancelAnimationFrame(flashProgressFrame);
    flashProgressFrame = undefined;
    if (!flashMessage || flashExiting) return;
    flashExiting = true;
    flashDismissTimer = setTimeout(clearFlash, 220);
  }

  function clearFlash() {
    flashMessage = '';
    flashVisible = false;
    flashExiting = false;
    flashRemaining = 4200;
    flashProgress = 1;
    if (flashTimer) clearTimeout(flashTimer);
    if (flashDismissTimer) clearTimeout(flashDismissTimer);
    if (flashProgressFrame) cancelAnimationFrame(flashProgressFrame);
    flashTimer = undefined;
    flashDismissTimer = undefined;
    flashProgressFrame = undefined;
  }

  function updateFlashProgress() {
    const elapsed = performance.now() - flashStartedAt;
    flashProgress = Math.max(0, Math.min(1, 1 - elapsed / flashRemaining));
    if (flashProgress > 0 && !flashExiting) {
      flashProgressFrame = requestAnimationFrame(updateFlashProgress);
    } else {
      flashProgressFrame = undefined;
    }
  }

  function startFlashCountdown() {
    if (flashTimer) clearTimeout(flashTimer);
    if (flashProgressFrame) cancelAnimationFrame(flashProgressFrame);
    flashStartedAt = performance.now();
    flashTimer = setTimeout(() => {
      flashTimer = undefined;
      dismissFlash();
    }, flashRemaining);
    flashProgressFrame = requestAnimationFrame(updateFlashProgress);
  }

  function pauseFlashCountdown() {
    if (!flashVisible || flashExiting || !flashTimer) return;
    flashRemaining = Math.max(0, flashRemaining - (performance.now() - flashStartedAt));
    clearTimeout(flashTimer);
    flashTimer = undefined;
    if (flashProgressFrame) cancelAnimationFrame(flashProgressFrame);
    flashProgressFrame = undefined;
  }

  function resumeFlashCountdown() {
    if (!flashVisible || flashExiting || flashTimer || flashRemaining <= 0) return;
    startFlashCountdown();
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
    setFlash('Malha sentinel resetada');
    navigate('/login');
    syncState();
  }

  function seedDemoContact() {
    const existing = readContacts();
    if (existing.length === 0) {
      writeContacts([seedContact]);
      setFlash('Sentinel demo inicializado');
    }
    syncState();
  }

  function startWizard() {
    wizard = emptyWizardState();
    wizardDirection = 1;
    wizardStep = 'basic';
    wizardError = '';
    navigate('/contacts/new');
  }

  function nextStep() {
    wizardError = '';
    if (wizardStep === 'basic') {
      if (!wizard.name.trim() || !wizard.document.trim()) {
        wizardError = 'Preencha nome e codigo do protocolo';
        return;
      }
    }

    if (wizardStep === 'address') {
      if (!wizard.address.cep.trim() || !wizard.address.street.trim() || !wizard.address.number.trim()) {
        wizardError = 'Preencha fonte, metrica e limite';
        return;
      }
    }

    if (wizardStep === 'owner') {
      if (!wizard.owner.name.trim() || !wizard.owner.email.trim()) {
        wizardError = 'Preencha acao e canal de notificacao';
        return;
      }
    }

    const index = steps.indexOf(wizardStep);
    if (index < steps.length - 1) {
      wizardDirection = 1;
      wizardStep = steps[index + 1];
    }
  }

  function backStep() {
    wizardError = '';
    const index = steps.indexOf(wizardStep);
    if (index > 0) {
      wizardDirection = -1;
      wizardStep = steps[index - 1];
    } else {
      navigate('/dashboard');
    }
  }

  function finishWizard() {
    if (!wizard.name.trim() || !wizard.document.trim()) {
      wizardError = 'Preencha nome e codigo do protocolo';
      return;
    }
    if (!wizard.address.cep.trim() || !wizard.address.street.trim() || !wizard.address.number.trim()) {
      wizardError = 'Preencha fonte, metrica e limite';
      return;
    }
    if (!wizard.owner.name.trim() || !wizard.owner.email.trim()) {
      wizardError = 'Preencha acao e canal de notificacao';
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
    setFlash('Sentinel armado com sucesso');
    navigate(`/contacts/${id}`);
    syncState();
  }

  function saveAddress() {
    if (!currentContact) return;

    if (!editAddress.cep.trim() || !editAddress.street.trim() || !editAddress.number.trim()) {
      editAddressError = 'Fonte, metrica e limite sao obrigatorios';
      return;
    }

    editAddressError = '';
    const updated: DemoContact = {
      ...currentContact,
      address: { ...editAddress },
    };
    upsertContact(updated);
    setFlash('Parametros do sentinel atualizados');
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
    loadSpaceWeather();
    initialized = true;
    ensureAuth();
    window.addEventListener('hashchange', handleHashChange);
    spaceWeatherTimer = setInterval(loadSpaceWeather, 60_000);
  });

  onDestroy(() => {
    window.removeEventListener('hashchange', handleHashChange);
    if (flashTimer) clearTimeout(flashTimer);
    if (flashDismissTimer) clearTimeout(flashDismissTimer);
    if (flashProgressFrame) cancelAnimationFrame(flashProgressFrame);
    if (spaceWeatherTimer) clearInterval(spaceWeatherTimer);
  });

  $: if (initialized && route.name === 'unknown') {
    navigate('/login');
  }

  $: if (initialized && !loggedIn && route.name !== 'login') {
    ensureAuth();
  }

  $: currentSection = getRouteLabel(route);
</script>

<div class="scene" aria-hidden="true">
  <div class="scene-grid"></div>
  <div class="scene-nebula scene-nebula-a"></div>
  <div class="scene-nebula scene-nebula-b"></div>
  <div class="scene-stars scene-stars-far"></div>
  <div class="scene-stars scene-stars-near"></div>
  <div class="scene-vignette"></div>
</div>

<div class="app-shell">
  <div class="edge-telemetry edge-telemetry-left" aria-hidden="true"><span>SYS // 024</span></div>
  <div class="edge-telemetry edge-telemetry-right" aria-hidden="true"><span>BR.EAST // ONLINE</span></div>

  <header class="topbar">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">
        <span></span>
        <i></i>
      </div>
      <div>
        <p class="eyebrow">Orbital Console</p>
        <strong>Helios Sentinel</strong>
      </div>
    </div>

    <nav class="topnav" aria-label="Navegacao principal">
      {#each navItems as item}
        <a
          href={toHash(item.href)}
          class:active={currentSection === item.label}
          aria-current={currentSection === item.label ? 'page' : undefined}
        >
          <span class="nav-icon" aria-hidden="true">
            {#if item.icon === 'grid'}
              <svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
            {:else if item.icon === 'target'}
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
            {:else}
              <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3" /><path d="M5 21c.5-4.5 2.8-7 7-7s6.5 2.5 7 7" /></svg>
            {/if}
          </span>
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="statusbar">
      <span class="status-pill"><i class:online={loggedIn}></i>{loggedIn ? 'session online' : 'guest mode'}</span>
      <span class="status-pill accent">{currentSection} // 01</span>
    </div>
  </header>

  <div class="system-rail" aria-hidden="true">
    <span>DS-01</span><i></i><em>OPERATIONS NETWORK</em><i></i><span>V1.0.0</span>
  </div>

  {#if flashMessage && flashVisible}
    <div
      class:flash-exiting={flashExiting}
      class="flash"
      data-testid="flash-message"
      role="status"
      on:mouseenter={pauseFlashCountdown}
      on:mouseleave={resumeFlashCountdown}
      transition:fly={{ y: -10, duration: 220, opacity: 0.2 }}
    >
      <span class="flash-signal" aria-hidden="true"><i></i></span>
      <span class="flash-copy"><small>System notification</small>{flashMessage}</span>
      <button class="flash-close" type="button" aria-label="Fechar notificação" on:click={dismissFlash}>×</button>
      <i class="flash-progress" aria-hidden="true" style={`transform: scaleX(${flashProgress})`}></i>
    </div>
  {/if}

  {#if route.name === 'login'}
    <main class="shell" data-testid="login-page">
      <section class="panel narrow">
        <span class="panel-index">AUTH // 001</span>
        <div class="panel-rule"></div>
        <p class="eyebrow">Secure Access</p>
        <h1>Acesso restrito</h1>
        <p class="lede">Autentique a sessão para remover o bloqueio do painel operacional.</p>
        <div class="access-status"><i></i><span>Canal criptografado</span><b>AES-256</b></div>
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
          <div class="actions">
            <button data-testid="login-submit" type="submit">Entrar</button>
          </div>
        </form>
      </section>
    </main>
  {:else if route.name === 'dashboard'}
    <main class="shell" data-testid="dashboard-page">
      <section class="page-header panel panel-hero">
        <span class="panel-index">OVERVIEW // 001</span>
        <div>
          <p class="eyebrow">Mission Overview</p>
          <h1>Helios Sentinel</h1>
          <p class="lede">Console de vigilancia orbital alimentado por telemetria NOAA em tempo quase real.</p>
          <div class="info-strip">
            <span class="info-chip">sentinels: {contacts.length}</span>
            <span class="info-chip">{sessionEmail}</span>
            {#if spaceWeather}
              <span class={`info-chip info-chip-${spaceWeather.statusSeverity}`}>{spaceWeather.statusLabel}</span>
            {/if}
          </div>
        </div>
        <div class="actions">
          <button data-testid="start-contact-wizard" on:click={startWizard}>Criar sentinel</button>
          <button data-testid="seed-demo-contact" class="button-ghost" on:click={seedDemoContact}>Seed sentinel demo</button>
          <button data-testid="reset-demo-data" class="button-ghost" on:click={resetDemoData}>Reset demo data</button>
          <button data-testid="logout" class="button-ghost" on:click={logout}>Sair</button>
        </div>
      </section>

      <section class="telemetry-grid" aria-label="Telemetria do sistema">
        <div class="telemetry-card" style="--card-index: 0"><span>Sentinels armados</span><strong>{String(contacts.length).padStart(2, '0')}</strong><i style={`--level: ${Math.min(100, 18 + contacts.length * 12)}%`}></i></div>
        <div class={`telemetry-card telemetry-card-${spaceWeather?.metrics.particleFlux.status ?? 'nominal'}`} style="--card-index: 1"><span>{spaceWeather?.metrics.particleFlux.label ?? 'Fluxo de particulas'}</span><strong>{spaceWeather?.metrics.particleFlux.value ?? '--'}<small>{spaceWeather?.metrics.particleFlux.unit ?? 'km/s'}</small></strong><i style={`--level: ${spaceWeather?.metrics.particleFlux.level ?? 12}%`}></i></div>
        <div class={`telemetry-card telemetry-card-${spaceWeather?.metrics.magneticStability.status ?? 'nominal'}`} style="--card-index: 2"><span>{spaceWeather?.metrics.magneticStability.label ?? 'Estabilidade magnetica'}</span><strong>{spaceWeather?.metrics.magneticStability.value ?? '--'}<small>{spaceWeather?.metrics.magneticStability.unit ?? 'Bz/Bt'}</small></strong><i style={`--level: ${spaceWeather?.metrics.magneticStability.level ?? 14}%`}></i></div>
        <div class={`telemetry-card telemetry-card-${spaceWeather?.metrics.orbitalRisk.status ?? 'nominal'}`} style="--card-index: 3"><span>{spaceWeather?.metrics.orbitalRisk.label ?? 'Indice de risco orbital'}</span><strong>{spaceWeather?.metrics.orbitalRisk.value ?? '--'}<small>{spaceWeather?.metrics.orbitalRisk.unit ?? 'Kp'}</small></strong><i style={`--level: ${spaceWeather?.metrics.orbitalRisk.level ?? 16}%`}></i></div>
      </section>

      <section class="dashboard-grid">
        <section class="panel panel-feed">
          <span class="panel-index">SIGNAL // NOAA</span>
          <div class="panel-rule"></div>
          <div class="panel-header">
            <div>
              <p class="eyebrow">Signal Feed</p>
              <h2>Anomalias interceptadas</h2>
            </div>
            <p class="muted">{spaceWeather?.source ?? 'NOAA / SWPC'}{spaceWeather ? ` // ${spaceWeather.updatedAt}` : ''}</p>
          </div>
          {#if spaceWeatherError}
            <div class="empty-state empty-state-compact">
              <span class="empty-radar" aria-hidden="true"><i></i></span>
              <div><strong>Link de telemetria indisponível</strong><p class="muted">{spaceWeatherError}</p></div>
            </div>
          {:else if !spaceWeather && spaceWeatherLoading}
            <div class="empty-state empty-state-compact">
              <span class="empty-radar" aria-hidden="true"><i></i></span>
              <div><strong>Sincronizando heliosfera</strong><p class="muted">Aguardando primeiro pacote de telemetria oficial.</p></div>
            </div>
          {:else}
            <div class="signal-feed">
              <div class={`signal-status signal-status-${spaceWeather?.statusSeverity ?? 'nominal'}`}>
                <strong>Status da malha</strong>
                <span>{spaceWeather?.statusLabel ?? 'nominal'}</span>
                <small>Atualizado em {spaceWeather?.updatedAt ?? '--'}</small>
              </div>
              {#each spaceWeather?.feed ?? [] as item, index}
                <article class={`signal-item signal-item-${item.severity}`} style={`--item-index: ${index}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <span>{item.issuedAt}</span>
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <section class="panel">
          <span class="panel-index">REGISTRY // {String(contacts.length).padStart(3, '0')}</span>
          <div class="panel-rule"></div>
          <div class="panel-header">
            <div>
              <p class="eyebrow">Sentinel Registry</p>
              <h2>Lista de sentinels</h2>
            </div>
            <p class="muted">Logado como: {sessionEmail}</p>
          </div>
          <div data-testid="contact-list" class="list">
            {#if contacts.length === 0}
              <div class="empty-state">
                <span class="empty-radar" aria-hidden="true"><i></i></span>
                <div><strong>Nenhum sentinel armado</strong><p class="muted">Crie um sentinel ou inicialize o registro de demonstração.</p></div>
              </div>
            {:else}
              {#each contacts as contact, index}
                <a data-testid="contact-list-item" class="list-item" style={`--item-index: ${index}`} href={toHash(`/contacts/${contact.id}`)}>
                  <span class="list-index">{String(index + 1).padStart(2, '0')}</span>
                  <span class="list-copy"><strong>{contact.name}</strong><span>{contact.document} // {getSentinelSubtitle(contact)}</span></span>
                  <span class="list-status"><i></i>{getSentinelState(contact)}</span>
                  <span class="list-arrow" aria-hidden="true">&#8599;</span>
                </a>
              {/each}
            {/if}
          </div>
        </section>
      </section>
    </main>
  {:else if route.name === 'contact-new'}
    <main class="shell" data-testid="contact-wizard-page">
      <section class="panel narrow">
        <span class="panel-index">SEQUENCE // {String(steps.indexOf(wizardStep) + 1).padStart(2, '0')}</span>
        <div class="panel-rule"></div>
        <div class="panel-header">
          <div>
            <p class="eyebrow">Sequence Builder</p>
            <h1>Armar sentinel</h1>
          </div>
          <p class="muted">Logado como: {sessionEmail}</p>
        </div>
        <div class="step-strip">
          {#each steps as step}
            <span class:active-step={step === wizardStep}>{stepLabels[step]}</span>
          {/each}
        </div>

        <div class="wizard-stage">
          {#key wizardStep}
            <div
              class:wizard-stage-backward={wizardDirection < 0}
              class:wizard-stage-forward={wizardDirection > 0}
              class="wizard-stage-frame"
              in:fly={{ x: wizardDirection > 0 ? 10 : -10, y: 6, duration: 240, opacity: 0.2 }}
              out:fly={{ x: wizardDirection > 0 ? -8 : 8, y: -4, duration: 180, opacity: 0.15 }}
            >
              {#if wizardStep === 'basic'}
                <div data-testid="contact-wizard-step-basic">
                  <h2>Etapa 1: Identidade do sentinel</h2>
                  <label>
                    Nome do sentinel
                    <input data-testid="contact-name" bind:value={wizard.name} />
                  </label>
                  <label>
                    Codigo do protocolo
                    <input data-testid="contact-document" bind:value={wizard.document} />
                  </label>
                </div>
              {:else if wizardStep === 'address'}
                <div data-testid="contact-wizard-step-address">
                  <h2>Etapa 2: Parametros de disparo</h2>
                  <label>
                    Fonte do sinal
                    <input
                      data-testid="contact-cep"
                      value={wizard.address.cep}
                      on:input={handleWizardCepInput}
                    />
                  </label>
                  <label>Metrica monitorada <input data-testid="contact-street" bind:value={wizard.address.street} /></label>
                  <label>Limite <input data-testid="contact-number" bind:value={wizard.address.number} /></label>
                  <label>Janela de observacao <input data-testid="contact-city" bind:value={wizard.address.city} /></label>
                  <label>
                    Severidade
                    <Select.Root type="single" bind:value={wizard.address.state} items={stateItems}>
                      <Select.Trigger data-testid="contact-state" class="select-trigger">
                        <Select.Value placeholder="Selecione a severidade" />
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content class="select-content" sideOffset={8}>
                          <Select.Viewport class="select-viewport">
                            {#each states as state}
                              <Select.Item value={state} label={state} class="select-item">
                                {state}
                              </Select.Item>
                            {/each}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  </label>
                </div>
              {:else if wizardStep === 'owner'}
                <div data-testid="contact-wizard-step-owner">
                  <h2>Etapa 3: Acionamento</h2>
                  <label>
                    Acao ao disparar
                    <input data-testid="contact-owner-name" bind:value={wizard.owner.name} />
                  </label>
                  <label>
                    Canal de notificacao
                    <input data-testid="contact-owner-email" bind:value={wizard.owner.email} />
                  </label>
                </div>
              {:else}
                <div data-testid="contact-wizard-step-review" class="review-card">
                  <h2>Etapa 4: Revisão</h2>
                  <p data-testid="review-contact-name"><strong>Sentinel:</strong> {wizard.name}</p>
                  <p data-testid="review-contact-document"><strong>Protocolo:</strong> {wizard.document}</p>
                  <p data-testid="review-contact-address">
                    <strong>Trigger:</strong> {wizard.address.cep} // {wizard.address.street} > {wizard.address.number} por {wizard.address.city} [{wizard.address.state}]
                  </p>
                  <p data-testid="review-contact-owner">
                    <strong>Acionamento:</strong> {wizard.owner.name} ({wizard.owner.email})
                  </p>
                </div>
              {/if}
            </div>
          {/key}
        </div>

        <p class="error" data-testid="wizard-error">{wizardError}</p>
        <div class="actions">
          {#if wizardStep !== 'basic'}
            <button data-testid="contact-wizard-back" class="button-ghost" type="button" on:click={backStep}>Voltar</button>
          {/if}
          {#if wizardStep !== 'review'}
            <button data-testid="contact-wizard-next" type="button" on:click={nextStep}>Próximo</button>
          {:else}
            <button data-testid="contact-wizard-finish" type="button" on:click={finishWizard}>Armar sentinel</button>
          {/if}
        </div>
      </section>
    </main>
  {:else if route.name === 'contact-detail'}
    <main class="shell" data-testid="contact-detail-page">
      {#if currentContact}
        <section class="panel narrow record-panel">
          <span class="panel-index">RECORD // 001</span>
          <div class="panel-rule"></div>
          <div class="panel-header">
            <div>
              <p class="eyebrow">Sentinel Record</p>
              <h1>Sentinel armado com sucesso</h1>
            </div>
            <p class="muted">Logado como: {sessionEmail}</p>
          </div>
          <div class="record-frame">
            <div class="record-banner">
              <span class="record-badge"><i></i>Registro estabilizado</span>
              <span class="record-id">ID // {currentContact.id}</span>
            </div>

            <div class="detail-grid">
              <div class="detail-cell detail-cell-highlight">
                <span class="detail-label">Status operacional</span>
                <p data-testid="contact-detail-status"><strong>{getSentinelState(currentContact)}</strong></p>
              </div>
              <div class="detail-cell">
                <span class="detail-label">Sentinel</span>
                <p data-testid="contact-detail-name"><strong>{currentContact.name}</strong></p>
              </div>
              <div class="detail-cell">
                <span class="detail-label">Protocolo</span>
                <p data-testid="contact-detail-document"><strong>{currentContact.document}</strong></p>
              </div>
              <div class="detail-cell detail-cell-wide">
                <span class="detail-label">Parametros de trigger</span>
                <p data-testid="contact-detail-address">
                  <strong>{currentContact.address.cep}</strong> // {currentContact.address.street} &gt; {currentContact.address.number} por {currentContact.address.city} [{currentContact.address.state}]
                </p>
              </div>
              <div class="detail-cell detail-cell-wide">
                <span class="detail-label">Acionamento</span>
                <p data-testid="contact-detail-owner">
                  <strong>{currentContact.owner.name}</strong> ({currentContact.owner.email})
                </p>
              </div>
            </div>
          </div>
          <div class="actions">
            <button data-testid="edit-address" type="button" on:click={() => navigate(`/contacts/${currentContact.id}/edit-address`)}>
              Editar parametros
            </button>
            <button data-testid="back-to-dashboard" class="button-ghost" type="button" on:click={() => navigate('/dashboard')}>
              Voltar ao dashboard
            </button>
            <button data-testid="logout" class="button-ghost" type="button" on:click={logout}>Sair</button>
          </div>
        </section>
      {:else}
        <section class="panel narrow">
          <span class="panel-index">ERROR // 404</span>
          <div class="panel-rule"></div>
          <h1>Sentinel não encontrado</h1>
          <div class="actions">
            <button type="button" on:click={() => navigate('/dashboard')}>Voltar ao dashboard</button>
          </div>
        </section>
      {/if}
    </main>
  {:else if route.name === 'contact-edit-address'}
    <main class="shell" data-testid="contact-edit-address-page">
      {#if currentContact}
        <section class="panel narrow">
          <span class="panel-index">OVERRIDE // 001</span>
          <div class="panel-rule"></div>
          <div class="panel-header">
            <div>
              <p class="eyebrow">Sentinel Override</p>
              <h1>Editar parametros</h1>
            </div>
            <p class="muted">Logado como: {sessionEmail}</p>
          </div>
          <label>
            Fonte do sinal
            <input
              data-testid="edit-contact-cep"
              value={editAddress.cep}
              on:input={handleEditCepInput}
            />
          </label>
          <label>Metrica monitorada <input data-testid="edit-contact-street" bind:value={editAddress.street} /></label>
          <label>Limite <input data-testid="edit-contact-number" bind:value={editAddress.number} /></label>
          <label>Janela de observacao <input data-testid="edit-contact-city" bind:value={editAddress.city} /></label>
          <label>
            Severidade
            <Select.Root type="single" bind:value={editAddress.state} items={stateItems}>
              <Select.Trigger data-testid="edit-contact-state" class="select-trigger">
                <Select.Value placeholder="Selecione a severidade" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content class="select-content" sideOffset={8}>
                  <Select.Viewport class="select-viewport">
                    {#each states as state}
                      <Select.Item value={state} label={state} class="select-item">
                        {state}
                      </Select.Item>
                    {/each}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </label>
          <p class="error" data-testid="edit-address-error">{editAddressError}</p>
          <div class="actions">
            <button data-testid="cancel-address" class="button-ghost" type="button" on:click={cancelAddress}>Cancelar</button>
            <button data-testid="save-address" type="button" on:click={saveAddress}>Salvar parametros</button>
            <button data-testid="logout" class="button-ghost" type="button" on:click={logout}>Sair</button>
          </div>
        </section>
      {:else}
        <section class="panel narrow">
          <span class="panel-index">ERROR // 404</span>
          <div class="panel-rule"></div>
          <h1>Sentinel não encontrado</h1>
          <div class="actions">
            <button type="button" on:click={() => navigate('/dashboard')}>Voltar ao dashboard</button>
          </div>
        </section>
      {/if}
    </main>
  {:else}
    <main class="shell">
      <section class="panel narrow">
        <div class="panel-rule"></div>
        <h1>Redirecionando...</h1>
      </section>
    </main>
  {/if}
</div>

<style>
  .scene {
    position: fixed;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }

  .scene-grid,
  .scene-nebula,
  .scene-stars {
    position: absolute;
    inset: 0;
  }

  .scene-grid {
    background-image:
      linear-gradient(rgba(111, 255, 237, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(111, 255, 237, 0.03) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: linear-gradient(180deg, transparent, black 18%, black 82%, transparent);
  }

  .scene-nebula-a {
    background:
      radial-gradient(circle at 18% 22%, rgba(78, 255, 228, 0.12), transparent 22%),
      radial-gradient(circle at 74% 20%, rgba(217, 255, 87, 0.09), transparent 18%),
      radial-gradient(circle at 50% 56%, rgba(34, 104, 110, 0.12), transparent 30%);
    filter: blur(18px);
  }

  .scene-nebula-b {
    background:
      radial-gradient(circle at 62% 72%, rgba(99, 242, 223, 0.08), transparent 20%),
      radial-gradient(circle at 30% 82%, rgba(12, 64, 71, 0.15), transparent 24%);
    filter: blur(40px);
  }

  .scene-stars {
    background-image:
      radial-gradient(circle at 14% 22%, rgba(235, 251, 253, 0.8) 0 1px, transparent 1.8px),
      radial-gradient(circle at 72% 18%, rgba(100, 242, 223, 0.7) 0 1px, transparent 1.8px),
      radial-gradient(circle at 68% 64%, rgba(235, 251, 253, 0.6) 0 1px, transparent 1.8px),
      radial-gradient(circle at 22% 74%, rgba(217, 255, 87, 0.55) 0 1px, transparent 2px),
      radial-gradient(circle at 84% 46%, rgba(235, 251, 253, 0.75) 0 1px, transparent 1.8px),
      radial-gradient(circle at 38% 38%, rgba(100, 242, 223, 0.45) 0 1px, transparent 2px);
    opacity: 0.8;
  }

  .app-shell {
    position: relative;
    z-index: 1;
    min-height: 100vh;
    padding: 24px 16px 48px;
  }

  .topbar {
    max-width: 1180px;
    margin: 0 auto 24px;
    padding: 18px 22px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 20px;
    align-items: center;
    border: 1px solid rgba(111, 255, 237, 0.18);
    clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
    background:
      linear-gradient(180deg, rgba(8, 27, 31, 0.88), rgba(4, 14, 17, 0.82)),
      radial-gradient(circle at top right, rgba(217, 255, 87, 0.12), transparent 24%);
    box-shadow: var(--shadow);
    backdrop-filter: blur(20px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .brand-mark {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    color: var(--bg-0);
    font-family: 'Rajdhani', sans-serif;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    background: linear-gradient(135deg, var(--lime), var(--cyan));
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
    box-shadow: 0 0 28px rgba(100, 242, 223, 0.24);
  }

  .brand strong,
  .topnav a,
  .status-pill,
  h1,
  h2,
  button,
  label {
    font-family: 'Rajdhani', sans-serif;
  }

  .brand strong {
    display: block;
    color: var(--text-0);
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .eyebrow {
    margin: 0 0 4px;
    color: var(--cyan);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .topnav {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .topnav a {
    padding: 10px 16px;
    border: 1px solid transparent;
    color: var(--text-2);
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.94rem;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
    transition: border-color 180ms ease, color 180ms ease, background 180ms ease;
  }

  .topnav a.active {
    color: #0b1517;
    background: linear-gradient(135deg, rgba(217, 255, 87, 0.92), rgba(145, 255, 170, 0.92));
    border-color: rgba(217, 255, 87, 0.72);
    box-shadow: 0 0 20px rgba(217, 255, 87, 0.12);
  }

  .statusbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .status-pill,
  .info-chip {
    --chip-corner: rgba(100, 242, 223, 0.42);
    display: inline-flex;
    align-items: center;
    min-height: 34px;
    padding: 0 12px;
    color: var(--text-1);
    border: 1px solid rgba(111, 255, 237, 0.18);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--chip-corner) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--chip-corner) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      rgba(8, 26, 30, 0.72);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-size: 0.82rem;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
  }

  .status-pill.accent {
    color: #081112;
    background: linear-gradient(135deg, rgba(100, 242, 223, 0.96), rgba(217, 255, 87, 0.88));
    border-color: rgba(100, 242, 223, 0.6);
  }

  .shell {
    max-width: 1180px;
    margin: 0 auto;
    padding: 8px 0 32px;
  }

  .panel {
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(9, 26, 30, 0.88), rgba(5, 16, 20, 0.82)),
      radial-gradient(circle at top right, rgba(100, 242, 223, 0.08), transparent 30%);
    border: 1px solid rgba(111, 255, 237, 0.2);
    padding: 28px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(20px);
    clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
  }

  .panel::before,
  .panel::after {
    content: '';
    position: absolute;
    pointer-events: none;
  }

  .panel::before {
    inset: 0;
    background-image: radial-gradient(rgba(111, 255, 237, 0.12) 0.8px, transparent 0.8px);
    background-size: 18px 18px;
    opacity: 0.12;
  }

  .panel::after {
    inset: 1px;
    border: 1px solid rgba(217, 255, 87, 0.06);
    clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
  }

  .narrow {
    max-width: 680px;
  }

  .panel-hero {
    grid-template-columns: 1fr auto;
    margin-bottom: 24px;
  }

  .panel-header {
    position: relative;
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: flex-start;
    margin-bottom: 18px;
    padding: 14px 16px 12px;
    border: 1px solid rgba(100, 242, 223, 0.12);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.3) 46% 54%, transparent 58%) top right / 12px 12px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.3) 46% 54%, transparent 58%) bottom left / 12px 12px no-repeat,
      linear-gradient(180deg, rgba(8, 24, 28, 0.42), rgba(8, 24, 28, 0.18));
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
  }

  .page-header {
    display: grid;
    align-items: flex-start;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
  }

  .list {
    display: grid;
    gap: 14px;
  }

  .list-item {
    display: grid;
    gap: 6px;
    padding: 16px 18px;
    border: 1px solid rgba(111, 255, 237, 0.16);
    background: linear-gradient(180deg, rgba(10, 31, 36, 0.8), rgba(7, 20, 24, 0.76));
    text-decoration: none;
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
    transition: border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
  }

  .list-item:hover {
    transform: translateY(-1px);
    border-color: rgba(111, 255, 237, 0.38);
    box-shadow: 0 0 24px rgba(100, 242, 223, 0.12);
  }

  form,
  label {
    display: grid;
    gap: 8px;
  }

  form {
    gap: 16px;
  }

  input {
    border: 1px solid rgba(111, 255, 237, 0.22);
    padding: 12px 14px;
    color: var(--text-0);
    background: rgba(3, 14, 17, 0.88);
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
    outline: none;
    transition: border-color 180ms ease, box-shadow 180ms ease;
  }

  input:focus {
    border-color: rgba(100, 242, 223, 0.58);
    box-shadow: 0 0 0 1px rgba(100, 242, 223, 0.18), 0 0 24px rgba(100, 242, 223, 0.12);
  }

  :global(.select-trigger) {
    min-height: 46px;
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid rgba(111, 255, 237, 0.22);
    background: rgba(3, 14, 17, 0.88);
    color: var(--text-0);
    cursor: pointer;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
  }

  :global(.select-content) {
    z-index: 40;
    width: var(--bits-select-anchor-width);
    min-width: var(--bits-select-anchor-width);
    max-height: min(280px, var(--bits-select-content-available-height));
    overflow: hidden;
    border: 1px solid rgba(111, 255, 237, 0.22);
    background: rgba(7, 22, 26, 0.96);
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
    backdrop-filter: blur(14px);
  }

  :global(.select-viewport) {
    padding: 6px;
    display: grid;
    gap: 4px;
    max-height: min(280px, var(--bits-select-content-available-height));
    overflow: auto;
  }

  :global(.select-item) {
    display: flex;
    align-items: center;
    min-height: 38px;
    padding: 8px 10px;
    background: transparent;
    color: var(--text-1);
    cursor: pointer;
  }

  :global(.select-item[data-highlighted]) {
    background: rgba(100, 242, 223, 0.12);
  }

  :global(.select-item[data-selected]) {
    background: rgba(217, 255, 87, 0.16);
    color: var(--text-0);
  }

  button {
    border: 1px solid rgba(217, 255, 87, 0.56);
    padding: 12px 18px;
    background: linear-gradient(135deg, rgba(217, 255, 87, 0.96), rgba(165, 255, 130, 0.92));
    color: #081112;
    cursor: pointer;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
    transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
  }

  button:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 26px rgba(217, 255, 87, 0.18);
  }

  .button-ghost {
    border-color: rgba(111, 255, 237, 0.24);
    background: rgba(8, 24, 28, 0.74);
    color: var(--text-1);
  }

  button[type='button']:not(:hover),
  button[type='submit']:not(:hover) {
    opacity: 0.98;
  }

  h1 {
    margin: 0 0 12px;
    color: var(--text-0);
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 0.98;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0 0 16px;
    color: var(--text-0);
    font-size: 1.55rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  p {
    margin: 8px 0;
  }

  strong {
    color: var(--text-0);
  }

  .lede {
    max-width: 48rem;
    color: var(--text-1);
    font-size: 1.02rem;
  }

  .error {
    color: var(--danger);
    min-height: 1.5em;
  }

  .muted {
    color: var(--text-2);
  }

  .flash {
    position: sticky;
    top: 16px;
    z-index: 10;
    max-width: 1180px;
    margin: 0 auto 20px;
    padding: 14px 18px;
    background: rgba(9, 32, 22, 0.9);
    color: var(--success);
    border: 1px solid rgba(156, 255, 186, 0.28);
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  }

  .panel-rule {
    width: 100%;
    height: 1px;
    margin-bottom: 20px;
    background: linear-gradient(90deg, transparent, rgba(100, 242, 223, 0.8), rgba(217, 255, 87, 0.5), transparent);
  }

  .step-strip,
  .info-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .step-strip {
    margin-bottom: 22px;
  }

  .step-strip span {
    padding: 8px 12px;
    color: var(--text-2);
    border: 1px solid rgba(111, 255, 237, 0.16);
    background: rgba(8, 24, 28, 0.56);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-family: 'Rajdhani', sans-serif;
    clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px));
  }

  .step-strip .active-step {
    color: #081112;
    background: linear-gradient(135deg, rgba(100, 242, 223, 0.96), rgba(217, 255, 87, 0.9));
    border-color: rgba(100, 242, 223, 0.52);
  }

  .detail-grid,
  .review-card {
    position: relative;
    padding: 18px;
    border-left: 3px solid rgba(100, 242, 223, 0.8);
    background: linear-gradient(180deg, rgba(9, 31, 36, 0.74), rgba(6, 18, 21, 0.7));
    box-shadow: inset 0 0 0 1px rgba(111, 255, 237, 0.1), 0 0 26px rgba(100, 242, 223, 0.08);
  }

  .detail-grid {
    display: grid;
    gap: 8px;
  }

  .record-panel {
    --panel-corner: rgba(156, 255, 186, 0.68);
    background:
      linear-gradient(to bottom left, transparent 43%, var(--panel-corner) 47% 53%, transparent 57%) top right / 18px 18px no-repeat,
      linear-gradient(to bottom left, transparent 43%, var(--panel-corner) 47% 53%, transparent 57%) bottom left / 18px 18px no-repeat,
      radial-gradient(circle at 82% 12%, rgba(156, 255, 186, 0.12), transparent 22%),
      radial-gradient(circle at 18% 84%, rgba(100, 242, 223, 0.1), transparent 26%),
      linear-gradient(145deg, rgba(8, 24, 28, 0.78), rgba(4, 16, 19, 0.72));
    backdrop-filter: blur(26px);
  }

  .record-frame {
    position: relative;
    display: grid;
    gap: 16px;
    padding: 18px;
    margin-top: 6px;
    border: 1px solid rgba(100, 242, 223, 0.14);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.46) 46% 54%, transparent 58%) top right / 14px 14px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.46) 46% 54%, transparent 58%) bottom left / 14px 14px no-repeat,
      linear-gradient(180deg, rgba(7, 27, 31, 0.54), rgba(3, 13, 16, 0.42));
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.03),
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 0 30px rgba(100, 242, 223, 0.06);
    clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
    overflow: hidden;
    transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
  }

  .record-frame::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 72% 24%, rgba(100, 242, 223, 0.08), transparent 20%),
      radial-gradient(circle at 18% 72%, rgba(217, 255, 87, 0.05), transparent 18%),
      linear-gradient(90deg, rgba(100, 242, 223, 0.07), transparent 24%, transparent 76%, rgba(100, 242, 223, 0.04));
    pointer-events: none;
  }

  .record-frame::after {
    content: '';
    position: absolute;
    inset: 7px;
    pointer-events: none;
    background:
      linear-gradient(var(--lime), var(--lime)) 0 0 / 22px 1px no-repeat,
      linear-gradient(var(--lime), var(--lime)) 0 0 / 1px 22px no-repeat,
      linear-gradient(var(--cyan), var(--cyan)) 100% 100% / 22px 1px no-repeat,
      linear-gradient(var(--cyan), var(--cyan)) 100% 100% / 1px 22px no-repeat;
    opacity: 0.62;
    animation: frame-trace 860ms cubic-bezier(0.2, 0.9, 0.16, 1) both;
    animation-delay: 150ms;
  }

  .record-panel:hover .record-frame {
    border-color: rgba(100, 242, 223, 0.24);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.04),
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 0 36px rgba(100, 242, 223, 0.1);
  }

  .record-banner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
  }

  .record-badge,
  .record-id,
  .detail-label {
    font-family: 'Rajdhani', sans-serif;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .record-badge {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 38px;
    padding: 9px 14px;
    color: var(--text-0);
    border: 1px solid rgba(100, 242, 223, 0.22);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.54) 46% 54%, transparent 58%) top right / 12px 12px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.54) 46% 54%, transparent 58%) bottom left / 12px 12px no-repeat,
      linear-gradient(90deg, rgba(100, 242, 223, 0.12), rgba(8, 24, 28, 0.44));
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
  }

  .record-badge i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 10px rgba(156, 255, 186, 0.72);
  }

  .record-id {
    color: rgba(186, 219, 224, 0.7);
    font-size: 0.76rem;
  }

  .detail-grid {
    position: relative;
    z-index: 1;
    padding: 0;
    border: 0;
    background: none;
    box-shadow: none;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .detail-cell {
    position: relative;
    min-width: 0;
    padding: 16px 16px 15px;
    border: 1px solid rgba(100, 242, 223, 0.14);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.34) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.34) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(180deg, rgba(8, 26, 30, 0.58), rgba(4, 14, 17, 0.42));
    backdrop-filter: blur(10px);
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
    transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
  }

  .detail-cell::after {
    content: '';
    position: absolute;
    inset: 7px;
    pointer-events: none;
    background:
      linear-gradient(rgba(100, 242, 223, 0.84), rgba(100, 242, 223, 0.84)) 100% 0 / 12px 1px no-repeat,
      linear-gradient(rgba(100, 242, 223, 0.84), rgba(100, 242, 223, 0.84)) 100% 0 / 1px 12px no-repeat,
      linear-gradient(rgba(100, 242, 223, 0.62), rgba(100, 242, 223, 0.62)) 0 100% / 12px 1px no-repeat,
      linear-gradient(rgba(100, 242, 223, 0.62), rgba(100, 242, 223, 0.62)) 0 100% / 1px 12px no-repeat;
    opacity: 0.74;
    animation: chamfer-trace 720ms cubic-bezier(0.2, 0.9, 0.16, 1) both;
    animation-delay: 220ms;
  }

  .detail-cell:hover {
    transform: translateY(-2px);
    border-color: rgba(100, 242, 223, 0.26);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), 0 0 24px rgba(100, 242, 223, 0.08);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.52) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.52) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(180deg, rgba(8, 28, 32, 0.66), rgba(4, 14, 17, 0.5));
  }

  .detail-cell p {
    margin: 0;
    color: var(--text-1);
    line-height: 1.45;
  }

  .detail-cell strong {
    display: inline-block;
    color: var(--text-0);
    font-family: 'Rajdhani', sans-serif;
    font-size: 1.08rem;
    font-weight: 500;
    letter-spacing: 0.04em;
  }

  .detail-label {
    display: inline-block;
    margin-bottom: 8px;
    color: rgba(148, 183, 188, 0.82);
    font-size: 0.7rem;
  }

  .detail-cell-highlight {
    border-color: rgba(156, 255, 186, 0.22);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(156, 255, 186, 0.42) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.4) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(135deg, rgba(12, 40, 32, 0.64), rgba(5, 18, 20, 0.48));
  }

  .detail-cell-highlight strong {
    color: var(--success);
    text-transform: uppercase;
  }

  .detail-cell-highlight:hover {
    border-color: rgba(156, 255, 186, 0.3);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), 0 0 26px rgba(156, 255, 186, 0.1);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(156, 255, 186, 0.52) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.46) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(135deg, rgba(14, 46, 36, 0.72), rgba(5, 18, 20, 0.52));
  }

  .detail-cell-wide {
    grid-column: 1 / -1;
  }

  /* Deep-space atmosphere and interface chrome. */
  .scene-grid {
    background-size: 88px 88px;
    transform: perspective(520px) rotateX(62deg) scale(1.35) translateY(30%);
    transform-origin: center bottom;
    mask-image: linear-gradient(180deg, transparent 2%, black 48%, transparent 96%);
    opacity: 0.62;
    animation: grid-drift 28s linear infinite;
  }

  .scene-nebula-a {
    background:
      radial-gradient(ellipse at 14% 36%, rgba(34, 189, 169, 0.12), transparent 28%),
      radial-gradient(ellipse at 82% 12%, rgba(153, 181, 38, 0.08), transparent 22%),
      radial-gradient(ellipse at 56% 62%, rgba(20, 102, 109, 0.1), transparent 34%);
    filter: blur(28px);
    animation: nebula-breathe-a 16s ease-in-out infinite alternate;
  }

  .scene-nebula-b { filter: blur(54px); animation: nebula-breathe-b 20s ease-in-out infinite alternate; }

  .scene-stars-far {
    background-image:
      radial-gradient(circle, rgba(193, 247, 242, 0.65) 0 0.7px, transparent 1px),
      radial-gradient(circle, rgba(96, 220, 205, 0.45) 0 0.6px, transparent 1px);
    background-position: 0 0, 39px 61px;
    background-size: 127px 113px, 173px 151px;
    opacity: 0.46;
    animation: stars-drift-far 44s linear infinite;
  }

  .scene-stars-near {
    background-image:
      radial-gradient(circle at 8% 31%, rgba(235, 251, 253, 0.7) 0 1px, transparent 2px),
      radial-gradient(circle at 91% 17%, rgba(100, 242, 223, 0.65) 0 1px, transparent 2px),
      radial-gradient(circle at 77% 72%, rgba(235, 251, 253, 0.6) 0 1px, transparent 2px),
      radial-gradient(circle at 25% 81%, rgba(217, 255, 87, 0.5) 0 1px, transparent 2px),
      radial-gradient(circle at 62% 44%, rgba(100, 242, 223, 0.45) 0 1px, transparent 2px);
    filter: drop-shadow(0 0 4px rgba(100, 242, 223, 0.7));
    animation: stars-drift-near 26s linear infinite;
  }

  .scene-vignette {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(0, 5, 6, 0.72), transparent 20%, transparent 80%, rgba(0, 5, 6, 0.72)),
      linear-gradient(180deg, rgba(0, 4, 5, 0.28), transparent 25%, transparent 72%, rgba(0, 4, 5, 0.58));
  }

  .app-shell { padding: 26px clamp(18px, 3vw, 56px) 64px; }

  .topbar {
    max-width: 1320px;
    margin-bottom: 12px;
    padding: 10px 2px 18px;
    border: 0;
    border-bottom: 1px solid rgba(111, 255, 237, 0.18);
    clip-path: none;
    background: none;
    box-shadow: none;
    backdrop-filter: none;
    animation: chrome-rise 420ms ease-out both;
  }

  .brand-mark {
    position: relative;
    width: 42px;
    height: 42px;
    border: 1px solid rgba(100, 242, 223, 0.75);
    border-radius: 50%;
    background: rgba(4, 20, 22, 0.72);
    clip-path: none;
    box-shadow: inset 0 0 16px rgba(100, 242, 223, 0.13), 0 0 22px rgba(100, 242, 223, 0.14);
  }

  .brand-mark::before,
  .brand-mark::after,
  .brand-mark span,
  .brand-mark i {
    content: '';
    position: absolute;
    border-radius: 50%;
  }

  .brand-mark::before { inset: 7px; border: 2px solid var(--cyan); }
  .brand-mark::after { inset: 14px; background: var(--lime); box-shadow: 0 0 12px var(--lime); }
  .brand-mark span { inset: -5px 17px; border-radius: 0; border-block: 2px solid var(--cyan); }
  .brand-mark i { inset: 17px -5px; border-radius: 0; border-inline: 2px solid var(--cyan); }

  .brand strong { font-size: 1.2rem; }

  .topnav a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px));
    position: relative;
    overflow: hidden;
  }

  .topnav a::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(110deg, transparent 18%, rgba(100, 242, 223, 0.22) 50%, transparent 82%);
    transform: translateX(-130%);
    opacity: 0;
    pointer-events: none;
  }

  .topnav a.active {
    color: var(--lime);
    background: rgba(217, 255, 87, 0.06);
    border-color: rgba(217, 255, 87, 0.46);
    box-shadow: inset 0 -2px rgba(217, 255, 87, 0.62), 0 0 20px rgba(217, 255, 87, 0.08);
    animation: nav-active-sweep 2.6s ease-in-out infinite;
  }

  .topnav a.active::after,
  .topnav a:hover::after,
  .topnav a:focus-visible::after {
    opacity: 1;
    animation: sweep-x 880ms ease-out both;
  }

  .nav-icon { width: 17px; height: 17px; display: inline-flex; }
  .nav-icon svg { width: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .topnav a:first-child .nav-icon svg path { fill: currentColor; stroke: none; }

  .status-pill.accent {
    color: var(--cyan);
    background: rgba(100, 242, 223, 0.06);
    border-color: rgba(100, 242, 223, 0.3);
  }

  .status-pill > i,
  .list-status i,
  .access-status i {
    width: 6px;
    height: 6px;
    margin-right: 8px;
    border-radius: 50%;
    background: #67777a;
    box-shadow: 0 0 0 3px rgba(103, 119, 122, 0.08);
  }

  .status-pill > i.online,
  .list-status i,
  .access-status i {
    background: var(--lime);
    box-shadow: 0 0 9px rgba(217, 255, 87, 0.72);
  }

  .system-rail {
    max-width: 1320px;
    margin: 0 auto 34px;
    display: grid;
    grid-template-columns: auto 1fr auto 1fr auto;
    align-items: center;
    gap: 12px;
    color: rgba(126, 161, 167, 0.66);
    font-family: 'Rajdhani', sans-serif;
    font-size: 0.68rem;
    letter-spacing: 0.22em;
    animation: chrome-rise 520ms ease-out both;
  }

  .system-rail i { height: 1px; background: linear-gradient(90deg, transparent, rgba(100, 242, 223, 0.28), transparent); }
  .system-rail em { color: rgba(100, 242, 223, 0.68); font-style: normal; }

  .edge-telemetry {
    position: fixed;
    top: 50%;
    z-index: 4;
    color: rgba(100, 242, 223, 0.34);
    font-family: 'Rajdhani', sans-serif;
    font-size: 0.62rem;
    letter-spacing: 0.28em;
    writing-mode: vertical-rl;
    animation: telemetry-fade 2.8s ease-in-out infinite alternate;
  }

  .edge-telemetry::before,
  .edge-telemetry::after {
    content: '';
    display: inline-block;
    width: 1px;
    height: 48px;
    margin: 10px 0;
    background: linear-gradient(transparent, var(--cyan), transparent);
  }

  .edge-telemetry-left { left: 12px; transform: translateY(-50%) rotate(180deg); }
  .edge-telemetry-right { right: 12px; transform: translateY(-50%); }

  .shell { max-width: 1120px; }

  .panel {
    isolation: isolate;
    --panel-corner: rgba(100, 242, 223, 0.58);
    background:
      linear-gradient(to bottom left, transparent 43%, var(--panel-corner) 47% 53%, transparent 57%) top right / 18px 18px no-repeat,
      linear-gradient(to bottom left, transparent 43%, var(--panel-corner) 47% 53%, transparent 57%) bottom left / 18px 18px no-repeat,
      radial-gradient(ellipse at 74% 0%, rgba(25, 120, 113, 0.1), transparent 34%),
      linear-gradient(135deg, rgba(7, 24, 28, 0.92), rgba(3, 13, 16, 0.84));
    border-color: rgba(111, 255, 237, 0.24);
    padding: clamp(26px, 4vw, 46px);
    box-shadow: var(--shadow), inset 0 0 70px rgba(0, 0, 0, 0.18);
    animation: panel-in 440ms cubic-bezier(0.2, 0.9, 0.16, 1) both;
  }

  .panel::before {
    opacity: 0.22;
    z-index: -1;
    mask-image: linear-gradient(90deg, black, transparent 76%);
  }

  .panel::after {
    inset: 8px;
    border: 0;
    background:
      linear-gradient(var(--lime), var(--lime)) 0 0 / 24px 1px no-repeat,
      linear-gradient(var(--lime), var(--lime)) 0 0 / 1px 24px no-repeat,
      linear-gradient(var(--cyan), var(--cyan)) 100% 100% / 24px 1px no-repeat,
      linear-gradient(var(--cyan), var(--cyan)) 100% 100% / 1px 24px no-repeat;
    opacity: 0.5;
    z-index: 2;
    animation: frame-trace 920ms cubic-bezier(0.2, 0.9, 0.16, 1) both;
    animation-delay: 170ms;
  }

  .narrow { max-width: 720px; margin-inline: auto; }

  .panel-index {
    position: absolute;
    top: 12px;
    right: 28px;
    color: rgba(126, 161, 167, 0.65);
    font-family: 'Rajdhani', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.2em;
  }

  .panel-hero { grid-template-columns: minmax(0, 1fr) minmax(250px, 0.55fr); }
  .panel-hero > .actions { justify-content: flex-end; max-width: 430px; margin-top: 4px; }

  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
    gap: 18px;
    align-items: start;
  }

  .telemetry-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }

  .telemetry-card {
    position: relative;
    min-height: 92px;
    padding: 17px 18px;
    overflow: hidden;
    border: 1px solid rgba(111, 255, 237, 0.16);
    background: linear-gradient(145deg, rgba(7, 25, 29, 0.82), rgba(3, 13, 16, 0.76));
    clip-path: polygon(0 0, calc(100% - 11px) 0, 100% 11px, 100% 100%, 11px 100%, 0 calc(100% - 11px));
    animation: panel-in 360ms cubic-bezier(0.2, 0.9, 0.16, 1) both;
    animation-delay: calc(110ms + (var(--card-index, 0) * 70ms));
  }

  .telemetry-card::before,
  .signal-status::before,
  .signal-item::before,
  .list-item::before {
    content: '';
    position: absolute;
    inset: 7px;
    pointer-events: none;
    background:
      linear-gradient(rgba(100, 242, 223, 0.82), rgba(100, 242, 223, 0.82)) 100% 0 / 12px 1px no-repeat,
      linear-gradient(rgba(100, 242, 223, 0.82), rgba(100, 242, 223, 0.82)) 100% 0 / 1px 12px no-repeat,
      linear-gradient(rgba(100, 242, 223, 0.58), rgba(100, 242, 223, 0.58)) 0 100% / 12px 1px no-repeat,
      linear-gradient(rgba(100, 242, 223, 0.58), rgba(100, 242, 223, 0.58)) 0 100% / 1px 12px no-repeat;
    opacity: 0.74;
    animation: chamfer-trace 700ms cubic-bezier(0.2, 0.9, 0.16, 1) both;
    animation-delay: calc(190ms + (var(--card-index, var(--item-index, 0)) * 65ms));
  }

  .telemetry-card span { display: block; color: var(--text-2); font-family: 'Rajdhani', sans-serif; font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; }
  .telemetry-card strong { display: block; margin-top: 4px; color: var(--cyan); font-family: 'Rajdhani', sans-serif; font-size: 2.1rem; font-weight: 500; line-height: 1; }
  .telemetry-card small { margin-left: 3px; color: var(--text-2); font-size: 0.78rem; }
  .telemetry-card > i { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; transform-origin: left; background: linear-gradient(90deg, var(--cyan) var(--level), rgba(100, 242, 223, 0.08) var(--level)); box-shadow: 0 0 9px rgba(100, 242, 223, 0.28); animation: telemetry-fill 780ms cubic-bezier(0.2, 0.9, 0.16, 1) both; animation-delay: calc(220ms + (var(--card-index, 0) * 70ms)); }

  .telemetry-card-elevated { border-color: rgba(217, 255, 87, 0.28); }
  .telemetry-card-critical { border-color: rgba(255, 142, 121, 0.34); }
  .telemetry-card-critical strong { color: #ff8e79; }

  .signal-feed {
    display: grid;
    gap: 12px;
  }

  .signal-status {
    position: relative;
    display: grid;
    gap: 4px;
    padding: 15px 16px;
    border: 1px solid rgba(100, 242, 223, 0.16);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.38) 46% 54%, transparent 58%) top right / 12px 12px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.38) 46% 54%, transparent 58%) bottom left / 12px 12px no-repeat,
      linear-gradient(180deg, rgba(8, 26, 30, 0.72), rgba(4, 14, 17, 0.54));
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
  }

  .signal-status strong,
  .signal-item strong {
    font-family: 'Rajdhani', sans-serif;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .signal-status span {
    color: var(--text-0);
    font-size: 1.3rem;
    text-transform: uppercase;
  }

  .signal-status small {
    color: var(--text-2);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .signal-status-elevated { border-color: rgba(217, 255, 87, 0.28); }
  .signal-status-elevated span { color: var(--lime); }
  .signal-status-critical { border-color: rgba(255, 142, 121, 0.3); }
  .signal-status-critical span { color: #ff8e79; }

  .signal-item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    padding: 15px 16px;
    border: 1px solid rgba(100, 242, 223, 0.14);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.32) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.32) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(180deg, rgba(7, 24, 28, 0.68), rgba(4, 13, 16, 0.46));
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
    animation: list-item-in 320ms ease-out both;
    animation-delay: calc(140ms + (min(var(--item-index, 0), 8) * 48ms));
  }

  .signal-item p {
    margin: 5px 0 0;
    color: var(--text-1);
    font-size: 0.86rem;
  }

  .signal-item > span {
    color: var(--text-2);
    font-family: 'Rajdhani', sans-serif;
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .signal-item-elevated { border-color: rgba(217, 255, 87, 0.22); }
  .signal-item-critical { border-color: rgba(255, 142, 121, 0.28); }
  .signal-item-critical strong { color: #ff8e79; }

  .list-item {
    position: relative;
    --row-corner: rgba(100, 242, 223, 0.48);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--row-corner) 46% 54%, transparent 58%) top right / 12px 12px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--row-corner) 46% 54%, transparent 58%) bottom left / 12px 12px no-repeat,
      linear-gradient(180deg, rgba(10, 31, 36, 0.8), rgba(7, 20, 24, 0.76));
    grid-template-columns: 42px 1fr auto 30px;
    align-items: center;
    gap: 16px;
    animation: list-item-in 320ms ease-out both;
    animation-delay: calc(140ms + (min(var(--item-index, 0), 8) * 48ms));
  }

  .list-item:hover {
    --row-corner: rgba(100, 242, 223, 0.78);
    transform: translateX(3px);
  }
  .list-index { color: rgba(100, 242, 223, 0.48); font-family: 'Rajdhani', sans-serif; font-size: 1.2rem; border-right: 1px solid rgba(100, 242, 223, 0.14); }
  .list-copy { display: grid; gap: 2px; }
  .list-copy strong { font-family: 'Rajdhani', sans-serif; font-size: 1.05rem; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; }
  .list-copy > span { color: var(--text-2); font-size: 0.82rem; }
  .list-status { display: inline-flex; align-items: center; color: var(--text-2); font-family: 'Rajdhani', sans-serif; font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; }
  .list-arrow { color: var(--cyan); font-size: 1.1rem; transition: transform 180ms ease; }
  .list-item:hover .list-arrow { transform: translate(2px, -2px); }

  .empty-state { min-height: 170px; display: flex; align-items: center; justify-content: center; gap: 26px; border: 1px dashed rgba(100, 242, 223, 0.2); background: rgba(3, 14, 17, 0.38); }
  .empty-state-compact { min-height: 200px; }
  .empty-state strong { font-family: 'Rajdhani', sans-serif; font-size: 1.05rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; }
  .empty-radar { position: relative; width: 62px; height: 62px; border: 1px solid rgba(100, 242, 223, 0.35); border-radius: 50%; box-shadow: inset 0 0 20px rgba(100, 242, 223, 0.08); }
  .empty-radar::before, .empty-radar::after { content: ''; position: absolute; background: rgba(100, 242, 223, 0.2); }
  .empty-radar::before { width: 1px; inset-block: 7px; left: 50%; }
  .empty-radar::after { height: 1px; inset-inline: 7px; top: 50%; }
  .empty-radar i { position: absolute; inset: 13px; border: 1px solid rgba(217, 255, 87, 0.28); border-radius: 50%; animation: radar-pulse 2.8s ease-out infinite; }

  form > label,
  [data-testid='contact-wizard-step-basic'] label,
  [data-testid='contact-wizard-step-address'] label,
  [data-testid='contact-wizard-step-owner'] label,
  [data-testid='contact-edit-address-page'] label {
    margin-top: 10px;
    color: var(--text-2);
    font-size: 0.78rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  input,
  :global(.select-trigger) {
    --field-corner: rgba(111, 255, 237, 0.42);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--field-corner) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--field-corner) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(90deg, rgba(3, 14, 17, 0.94), rgba(7, 25, 28, 0.84));
    transition:
      border-color 180ms ease,
      box-shadow 180ms ease,
      transform 180ms ease,
      background-size 180ms ease,
      background-position 180ms ease;
  }

  input { min-height: 22px; }

  input:hover,
  :global(.select-trigger:hover) {
    --field-corner: rgba(100, 242, 223, 0.7);
    border-color: rgba(100, 242, 223, 0.38);
    transform: translateY(-1px);
  }

  input:focus,
  :global(.select-trigger:focus-visible),
  :global(.select-trigger[data-state='open']) {
    --field-corner: var(--cyan);
    transform: translateY(-1px);
  }

  button {
    --button-corner: rgba(8, 82, 78, 0.9);
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(to bottom left, transparent 42%, var(--button-corner) 46% 54%, transparent 58%) top right / 12px 12px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--button-corner) 46% 54%, transparent 58%) bottom left / 12px 12px no-repeat,
      linear-gradient(135deg, rgba(217, 255, 87, 0.96), rgba(165, 255, 130, 0.92));
  }

  button::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(112deg, transparent 22%, rgba(255, 255, 255, 0.28) 50%, transparent 78%);
    transform: translateX(-135%);
    opacity: 0;
    pointer-events: none;
  }

  button.button-ghost {
    --button-corner: rgba(111, 255, 237, 0.48);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--button-corner) 46% 54%, transparent 58%) top right / 12px 12px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--button-corner) 46% 54%, transparent 58%) bottom left / 12px 12px no-repeat,
      linear-gradient(rgba(8, 24, 28, 0.8), rgba(8, 24, 28, 0.8));
  }

  button:hover,
  button:focus-visible {
    --button-corner: var(--cyan);
  }

  button:hover::after,
  button:focus-visible::after {
    opacity: 1;
    animation: sweep-x 760ms ease-out both;
  }

  button:active {
    transform: translateY(1px) scale(0.985);
  }

  .status-pill {
    --status-corner: rgba(111, 255, 237, 0.42);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--status-corner) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--status-corner) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(rgba(8, 26, 30, 0.76), rgba(8, 26, 30, 0.76));
  }

  .status-pill.accent {
    --status-corner: rgba(100, 242, 223, 0.76);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--status-corner) 46% 54%, transparent 58%) top right / 10px 10px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--status-corner) 46% 54%, transparent 58%) bottom left / 10px 10px no-repeat,
      linear-gradient(rgba(100, 242, 223, 0.06), rgba(100, 242, 223, 0.06));
  }

  .info-chip-elevated {
    --chip-corner: rgba(217, 255, 87, 0.5);
    color: var(--lime);
    border-color: rgba(217, 255, 87, 0.34);
    box-shadow: inset 0 0 0 1px rgba(217, 255, 87, 0.05);
  }

  .info-chip-critical {
    --chip-corner: rgba(255, 142, 121, 0.5);
    color: #ff8e79;
    border-color: rgba(255, 142, 121, 0.34);
    box-shadow: inset 0 0 0 1px rgba(255, 142, 121, 0.05);
  }

  .step-strip span {
    --step-corner: rgba(111, 255, 237, 0.38);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--step-corner) 46% 54%, transparent 58%) top right / 8px 8px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--step-corner) 46% 54%, transparent 58%) bottom left / 8px 8px no-repeat,
      linear-gradient(rgba(8, 24, 28, 0.62), rgba(8, 24, 28, 0.62));
  }

  .step-strip span.active-step {
    --step-corner: rgba(5, 72, 69, 0.92);
    background:
      linear-gradient(to bottom left, transparent 42%, var(--step-corner) 46% 54%, transparent 58%) top right / 8px 8px no-repeat,
      linear-gradient(to bottom left, transparent 42%, var(--step-corner) 46% 54%, transparent 58%) bottom left / 8px 8px no-repeat,
      linear-gradient(135deg, rgba(100, 242, 223, 0.96), rgba(217, 255, 87, 0.9));
    animation: active-step-pulse 2.8s ease-in-out infinite;
  }

  .wizard-stage {
    position: relative;
    min-height: 336px;
    margin-bottom: 2px;
  }

  .wizard-stage-frame {
    position: relative;
  }

  [data-testid='contact-wizard-page'] .panel {
    --panel-corner: rgba(100, 242, 223, 0.7);
    background:
      linear-gradient(to bottom left, transparent 43%, rgba(100, 242, 223, 0.62) 47% 53%, transparent 57%) top right / 18px 18px no-repeat,
      linear-gradient(to bottom left, transparent 43%, rgba(100, 242, 223, 0.62) 47% 53%, transparent 57%) bottom left / 18px 18px no-repeat,
      radial-gradient(ellipse at 74% 0%, rgba(25, 120, 113, 0.1), transparent 34%),
      linear-gradient(135deg, rgba(7, 24, 28, 0.92), rgba(3, 13, 16, 0.84));
  }

  .flash {
    position: fixed;
    top: 24px;
    right: clamp(18px, 3vw, 56px);
    z-index: 50;
    width: min(390px, calc(100vw - 36px));
    margin: 0;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 13px;
    padding: 15px 16px;
    overflow: hidden;
    border-color: rgba(156, 255, 186, 0.34);
    background:
      linear-gradient(to bottom left, transparent 42%, rgba(156, 255, 186, 0.82) 46% 54%, transparent 58%) top right / 12px 12px no-repeat,
      linear-gradient(to bottom left, transparent 42%, rgba(100, 242, 223, 0.7) 46% 54%, transparent 58%) bottom left / 12px 12px no-repeat,
      linear-gradient(115deg, rgba(7, 35, 28, 0.97), rgba(4, 20, 22, 0.97));
    backdrop-filter: blur(18px);
    animation: toast-in 260ms ease-out both;
  }

  .flash.flash-exiting {
    animation: toast-out 220ms ease-in both;
  }

  .flash-signal {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(156, 255, 186, 0.42);
    border-radius: 50%;
    box-shadow: inset 0 0 12px rgba(156, 255, 186, 0.1);
  }

  .flash-signal i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 10px var(--success);
    animation: online-pulse 1.8s ease-in-out infinite;
  }

  .flash-copy {
    display: grid;
    gap: 2px;
    color: var(--text-0);
    font-size: 0.86rem;
  }

  .flash-copy small {
    color: var(--success);
    font-family: 'Rajdhani', sans-serif;
    font-size: 0.66rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  button.flash-close {
    --button-corner: transparent;
    width: 28px;
    height: 28px;
    padding: 0;
    display: grid;
    place-items: center;
    color: var(--text-2);
    border: 0;
    background: transparent;
    clip-path: none;
    font-family: inherit;
    font-size: 1.2rem;
    font-weight: 400;
    line-height: 1;
  }

  button.flash-close:hover {
    color: var(--text-0);
    background: rgba(100, 242, 223, 0.08);
    box-shadow: none;
    transform: none;
  }

  .flash-progress {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    transform-origin: left;
    background: linear-gradient(90deg, var(--success), var(--cyan));
    box-shadow: 0 0 8px rgba(156, 255, 186, 0.42);
    transition: transform 100ms linear;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes toast-out {
    from { opacity: 1; transform: translateY(0) scale(1); }
    to { opacity: 0; transform: translateY(-8px) scale(0.985); }
  }
  button { font-weight: 600; }
  button:focus-visible, a:focus-visible, input:focus-visible, :global(.select-trigger:focus-visible) { outline: 1px solid var(--lime); outline-offset: 3px; }
  .button-ghost:hover { color: var(--cyan); border-color: rgba(100, 242, 223, 0.54); box-shadow: 0 0 24px rgba(100, 242, 223, 0.1); }

  h1 { font-size: clamp(2.05rem, 4vw, 3.35rem); font-weight: 400; line-height: 1.02; }
  h2 { font-weight: 400; }

  .panel-rule {
    position: relative;
    background: linear-gradient(90deg, rgba(100, 242, 223, 0.85), rgba(100, 242, 223, 0.12) 62%, transparent);
    box-shadow: -10px 0 12px rgba(100, 242, 223, 0.2);
    overflow: hidden;
  }

  .panel-rule::after { content: ''; position: absolute; right: 0; width: 5px; height: 5px; top: -2px; background: var(--lime); transform: rotate(45deg); box-shadow: 0 0 8px rgba(217, 255, 87, 0.55); }
  .panel-rule::before { content: ''; position: absolute; inset: 0 auto 0 -18%; width: 18%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.52), transparent); animation: rule-scan 2.8s ease-in-out infinite; }

  .access-status { display: grid; grid-template-columns: auto 1fr auto; align-items: center; margin: 24px 0 10px; padding: 11px 14px; color: var(--text-2); border-left: 2px solid var(--cyan); background: linear-gradient(90deg, rgba(100, 242, 223, 0.1), transparent); font-family: 'Rajdhani', sans-serif; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; }
  .access-status b { color: var(--cyan); font-weight: 500; }

  .step-strip span { position: relative; flex: 1; text-align: center; }

  .status-pill > i.online,
  .list-status i,
  .access-status i {
    animation: online-pulse 2s ease-in-out infinite;
  }

  @keyframes panel-in {
    from { opacity: 0; transform: translateY(12px) scale(0.992); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes frame-trace {
    0% {
      opacity: 0;
      background-size:
        0 1px,
        1px 0,
        0 1px,
        1px 0;
    }
    35% {
      opacity: 0.9;
      background-size:
        24px 1px,
        1px 0,
        0 1px,
        1px 0;
    }
    68% {
      opacity: 0.8;
      background-size:
        24px 1px,
        1px 24px,
        24px 1px,
        1px 0;
    }
    100% {
      opacity: 0.5;
      background-size:
        24px 1px,
        1px 24px,
        24px 1px,
        1px 24px;
    }
  }

  @keyframes chamfer-trace {
    0% {
      opacity: 0;
      background-size:
        0 1px,
        1px 0,
        0 1px,
        1px 0;
    }
    32% {
      opacity: 0.88;
      background-size:
        12px 1px,
        1px 0,
        0 1px,
        1px 0;
    }
    66% {
      opacity: 0.82;
      background-size:
        12px 1px,
        1px 12px,
        12px 1px,
        1px 0;
    }
    100% {
      opacity: 0.74;
      background-size:
        12px 1px,
        1px 12px,
        12px 1px,
        1px 12px;
    }
  }

  @keyframes chrome-rise {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes list-item-in {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @keyframes telemetry-fill {
    from { transform: scaleX(0); opacity: 0.35; }
    to { transform: scaleX(1); opacity: 1; }
  }

  @keyframes sweep-x {
    from { transform: translateX(-135%); }
    to { transform: translateX(135%); }
  }

  @keyframes rule-scan {
    0%, 18% { transform: translateX(0); opacity: 0; }
    30% { opacity: 0.9; }
    62%, 100% { transform: translateX(660%); opacity: 0; }
  }

  @keyframes active-step-pulse {
    0%, 100% { box-shadow: 0 0 0 rgba(100, 242, 223, 0); }
    50% { box-shadow: 0 0 18px rgba(100, 242, 223, 0.14); }
  }

  @keyframes online-pulse {
    0%, 100% { opacity: 0.9; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.18); }
  }

  @keyframes radar-pulse {
    0% { opacity: 0.18; transform: scale(0.92); }
    65% { opacity: 0.58; transform: scale(1.08); }
    100% { opacity: 0; transform: scale(1.24); }
  }

  @keyframes telemetry-fade {
    from { opacity: 0.5; }
    to { opacity: 0.95; }
  }

  @keyframes nav-active-sweep {
    0%, 100% { box-shadow: inset 0 -2px rgba(217, 255, 87, 0.62), 0 0 20px rgba(217, 255, 87, 0.08); }
    50% { box-shadow: inset 0 -2px rgba(217, 255, 87, 0.82), 0 0 26px rgba(217, 255, 87, 0.12); }
  }

  @keyframes grid-drift {
    from { transform: perspective(520px) rotateX(62deg) scale(1.35) translate3d(0, 30%, 0); }
    to { transform: perspective(520px) rotateX(62deg) scale(1.35) translate3d(-10px, 28%, 0); }
  }

  @keyframes nebula-breathe-a {
    from { opacity: 0.88; transform: scale(1) translate3d(0, 0, 0); }
    to { opacity: 1; transform: scale(1.05) translate3d(8px, -6px, 0); }
  }

  @keyframes nebula-breathe-b {
    from { opacity: 0.72; transform: scale(1) translate3d(0, 0, 0); }
    to { opacity: 0.94; transform: scale(1.08) translate3d(-10px, 8px, 0); }
  }

  @keyframes stars-drift-far {
    from { transform: translate3d(0, 0, 0); }
    to { transform: translate3d(-18px, 12px, 0); }
  }

  @keyframes stars-drift-near {
    from { transform: translate3d(0, 0, 0); }
    to { transform: translate3d(14px, -10px, 0); }
  }

  @media (max-width: 980px) {
    .topbar {
      grid-template-columns: auto 1fr;
    }

    .topnav {
      justify-content: flex-end;
    }

    .statusbar {
      grid-column: 1 / -1;
      justify-content: flex-end;
    }

    .panel-hero {
      grid-template-columns: 1fr;
    }

    .panel-hero > .actions {
      justify-content: flex-start;
      max-width: none;
      margin-top: 22px;
    }

    .dashboard-grid,
    .telemetry-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 720px) {
    .app-shell {
      padding: 16px 14px 42px;
    }

    .topbar,
    .page-header,
    .panel-header {
      grid-template-columns: 1fr;
      flex-direction: column;
    }

    .topnav,
    .statusbar {
      justify-content: flex-start;
    }

    .topnav {
      grid-column: 1 / -1;
      order: 3;
      width: 100%;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
    }

    .topnav a {
      justify-content: center;
      padding-inline: 8px;
      font-size: 0.78rem;
    }

    .statusbar {
      grid-column: auto;
    }

    .status-pill:not(.accent),
    .system-rail em,
    .edge-telemetry {
      display: none;
    }

    .system-rail {
      grid-template-columns: auto 1fr 1fr auto;
      margin-bottom: 24px;
    }

    .telemetry-grid {
      grid-template-columns: 1fr;
    }

    .dashboard-grid {
      grid-template-columns: 1fr;
    }

    .panel {
      padding: 22px;
    }

    .panel-index {
      right: 22px;
    }

    .list-item {
      grid-template-columns: 34px 1fr 24px;
      gap: 10px;
    }

    .list-status {
      display: none;
    }

    .empty-state {
      padding: 24px;
      flex-direction: column;
      text-align: center;
    }

    .signal-item {
      grid-template-columns: 1fr;
    }

    .record-frame {
      padding: 15px;
    }

    .record-banner,
    .detail-grid {
      grid-template-columns: 1fr;
    }

    .detail-cell,
    .detail-cell-wide {
      grid-column: auto;
    }

    .step-strip {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }

    h1 {
      font-size: 2rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
</style>
