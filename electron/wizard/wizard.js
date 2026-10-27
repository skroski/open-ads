// OpenAds Desktop Wizard Controller
// Gerencia a interface reativa, os passos de configuração e a comunicação IPC

(function () {
  'use strict';

  let currentStep = 1;
  const state = {
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    accounts: [],
    selectedAccountId: '',
    loginCustomerId: '',
    allowedHosts: '',
    anthropicKey: '',
    panelToken: '',
    existingStatus: null,
  };

  const digits = (v) => String(v ?? '').replace(/\D/g, '');
  const fmtId = (v) => digits(v).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

  // ───────────────────────── Inicialização ─────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    setupNavigation();
    setupDropzone();
    setupCredentialsStep();
    setupOAuthStep();
    setupAccountsStep();
    setupOptionalStep();
    setupCompletionStep();
    setupModals();

    // Carrega status atual do sistema
    try {
      const status = await window.electronAPI.getStatus();
      state.existingStatus = status;

      if (status.configured) {
        const badge = document.getElementById('header-status-badge');
        if (badge) {
          badge.className = 'badge badge-soft badge-success text-xs';
          badge.textContent = 'Configurado';
        }

        if (status.keys.hasRefreshToken) {
          const box = document.getElementById('existing-token-box');
          if (box) box.classList.remove('hidden');
        }

        if (status.keys.customerId) {
          state.selectedAccountId = status.keys.customerId;
        }
        if (status.keys.loginCustomerId) {
          state.loginCustomerId = status.keys.loginCustomerId;
          const input = document.getElementById('input-login-customer-id');
          if (input) input.value = status.keys.loginCustomerId;
        }
        if (status.keys.allowedHosts) {
          state.allowedHosts = status.keys.allowedHosts;
          const input = document.getElementById('input-allowed-hosts');
          if (input) input.value = status.keys.allowedHosts;
        }
      }
    } catch (err) {
      console.warn('Erro ao obter status inicial:', err);
    }
  });

  // ───────────────────────── Tema Claro / Escuro ─────────────────────────

  function initTheme() {
    const saved = localStorage.getItem('openads_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);

    const btn = document.getElementById('btn-toggle-theme');
    if (btn) {
      btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('openads_theme', next);
      });
    }
  }

  // ───────────────────────── Navegação entre Passos ─────────────────────────

  function goToStep(step) {
    if (step < 1 || step > 6) return;
    currentStep = step;

    // Atualiza indicadores daisyUI steps
    const stepEls = document.querySelectorAll('.steps .step');
    stepEls.forEach((el, idx) => {
      const s = idx + 1;
      if (s < step) {
        el.className = 'step step-success';
      } else if (s === step) {
        el.className = 'step step-primary';
      } else {
        el.className = 'step';
      }
    });

    // Alterna visibilidade dos painéis
    document.querySelectorAll('.step-pane').forEach((p) => p.classList.remove('active'));
    const currentPane = document.getElementById(`pane-step-${step}`);
    if (currentPane) {
      currentPane.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Ações ao entrar em passos específicos
    if (step === 4 && (!state.accounts || state.accounts.length === 0)) {
      loadAccounts();
    }
    if (step === 6) {
      runFinalValidation();
    }
  }

  function setupNavigation() {
    // Passo 1
    document.getElementById('btn-next-step1')?.addEventListener('click', () => goToStep(2));
    document.getElementById('btn-guide-step1')?.addEventListener('click', () => openHelpModal());

    // Passo 2
    document.getElementById('btn-prev-step2')?.addEventListener('click', () => goToStep(1));
    document.getElementById('btn-next-step2')?.addEventListener('click', () => {
      validateAndAdvanceStep2();
    });

    // Passo 3
    document.getElementById('btn-prev-step3')?.addEventListener('click', () => goToStep(2));
    document.getElementById('btn-next-step3')?.addEventListener('click', () => goToStep(4));

    // Passo 4
    document.getElementById('btn-prev-step4')?.addEventListener('click', () => goToStep(3));
    document.getElementById('btn-next-step4')?.addEventListener('click', () => {
      validateAndAdvanceStep4();
    });

    // Passo 5
    document.getElementById('btn-prev-step5')?.addEventListener('click', () => goToStep(4));
    document.getElementById('btn-next-step5')?.addEventListener('click', () => {
      saveAndAdvanceStep5();
    });

    // Passo 6
    document.getElementById('btn-reconfigure-wizard')?.addEventListener('click', () => goToStep(1));
  }

  // ───────────────────────── Passo 2: Credenciais OAuth ─────────────────────────

  function setupDropzone() {
    const dropzone = document.getElementById('json-dropzone');
    const browseBtn = document.getElementById('btn-browse-json');

    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', async (e) => {
      const files = e.dataTransfer?.files;
      if (!files || !files.length) return;

      const file = files[0];
      if (!file.name.endsWith('.json')) {
        alert('Por favor, arraste um arquivo com extensão .json baixado do Google Cloud.');
        return;
      }

      try {
        const text = await file.text();
        applyParsedJson(text);
      } catch (err) {
        alert(`Erro ao ler o arquivo: ${err.message}`);
      }
    });

    browseBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await window.electronAPI.selectJsonFile();
      if (res && res.success) {
        applyParsedData(res.clientId, res.clientSecret);
      } else if (res && !res.success) {
        alert(res.error || 'Erro ao processar o arquivo JSON selecionado.');
      }
    });

    dropzone.addEventListener('click', async () => {
      browseBtn?.click();
    });
  }

  async function applyParsedJson(text) {
    const res = await window.electronAPI.parseJsonContent(text);
    if (res && res.success) {
      applyParsedData(res.clientId, res.clientSecret);
    } else {
      alert(res?.error || 'Não foi possível reconhecer o Client ID e Client Secret neste JSON.');
    }
  }

  function applyParsedData(clientId, clientSecret) {
    state.clientId = clientId;
    state.clientSecret = clientSecret;

    const inputId = document.getElementById('input-client-id');
    const inputSec = document.getElementById('input-client-secret');
    if (inputId) inputId.value = clientId;
    if (inputSec) inputSec.value = clientSecret;

    const banner = document.getElementById('json-success-banner');
    const preview = document.getElementById('json-preview-text');
    if (banner && preview) {
      banner.classList.remove('hidden');
      preview.textContent = `Client ID: ${clientId.slice(0, 15)}...apps.googleusercontent.com`;
    }
  }

  function setupCredentialsStep() {
    const inputId = document.getElementById('input-client-id');
    const inputSec = document.getElementById('input-client-secret');

    inputId?.addEventListener('input', (e) => {
      state.clientId = e.target.value.trim();
    });
    inputSec?.addEventListener('input', (e) => {
      state.clientSecret = e.target.value.trim();
    });

    document.getElementById('btn-toggle-secret-visibility')?.addEventListener('click', () => {
      if (inputSec) {
        inputSec.type = inputSec.type === 'password' ? 'text' : 'password';
      }
    });

    document.getElementById('btn-open-cloud-console')?.addEventListener('click', () => {
      window.electronAPI.openExternal('https://console.cloud.google.com/apis/credentials');
    });
  }

  function validateAndAdvanceStep2() {
    const id = state.clientId.trim();
    const sec = state.clientSecret.trim();

    if (!id || !id.endsWith('.apps.googleusercontent.com')) {
      alert('O Client ID informado parece inválido. Ele deve terminar em ".apps.googleusercontent.com".');
      return;
    }
    if (!sec) {
      alert('O Client Secret é obrigatório.');
      return;
    }

    goToStep(3);
  }

  // ───────────────────────── Passo 3: Autorização Google ─────────────────────────

  function setupOAuthStep() {
    const startBtn = document.getElementById('btn-start-google-auth');
    const nextBtn = document.getElementById('btn-next-step3');
    const keepBtn = document.getElementById('btn-keep-token');

    keepBtn?.addEventListener('click', () => {
      state.refreshToken = 'EXISTING';
      if (nextBtn) nextBtn.disabled = false;
      const successBanner = document.getElementById('oauth-success-banner');
      if (successBanner) {
        successBanner.classList.remove('hidden');
        successBanner.querySelector('p').textContent = 'Refresh token atual preservado.';
      }
    });

    startBtn?.addEventListener('click', async () => {
      const includeExtras = document.getElementById('check-scope-extras')?.checked ?? true;
      const errorBanner = document.getElementById('oauth-error-banner');
      const successBanner = document.getElementById('oauth-success-banner');

      errorBanner?.classList.add('hidden');
      successBanner?.classList.add('hidden');

      startBtn.disabled = true;
      startBtn.classList.add('btn-disabled');
      const originalHtml = startBtn.innerHTML;
      startBtn.innerHTML = '<span class="loading loading-spinner loading-md"></span> Aguardando autorização no navegador...';

      try {
        const res = await window.electronAPI.startOAuth({
          clientId: state.clientId,
          clientSecret: state.clientSecret,
          includeExtras,
        });

        if (res.success && res.refreshToken) {
          state.refreshToken = res.refreshToken;
          successBanner?.classList.remove('hidden');
          if (nextBtn) nextBtn.disabled = false;

          // Avança automaticamente após 1 segundo
          setTimeout(() => {
            goToStep(4);
          }, 1200);
        } else {
          throw new Error(res.error || 'Não foi possível obter o refresh token.');
        }
      } catch (err) {
        if (errorBanner) {
          errorBanner.classList.remove('hidden');
          document.getElementById('oauth-error-text').textContent = err.message;
        }
      } finally {
        startBtn.disabled = false;
        startBtn.classList.remove('btn-disabled');
        startBtn.innerHTML = originalHtml;
      }
    });
  }

  // ───────────────────────── Passo 4: Escolha de Contas ─────────────────────────

  function setupAccountsStep() {
    const inputCust = document.getElementById('input-customer-id');
    const inputLogin = document.getElementById('input-login-customer-id');
    const testBtn = document.getElementById('btn-test-account-conn');
    const nextBtn = document.getElementById('btn-next-step4');

    inputCust?.addEventListener('input', (e) => {
      state.selectedAccountId = digits(e.target.value);
      if (nextBtn) nextBtn.disabled = state.selectedAccountId.length !== 10;
    });

    inputLogin?.addEventListener('input', (e) => {
      state.loginCustomerId = digits(e.target.value);
    });

    testBtn?.addEventListener('click', async () => {
      const targetId = state.selectedAccountId || digits(inputCust?.value);
      if (!targetId || targetId.length !== 10) {
        alert('Selecione ou digite um Customer ID de 10 dígitos para testar.');
        return;
      }

      const resultBox = document.getElementById('account-test-result');
      if (resultBox) {
        resultBox.innerHTML = '<span class="loading loading-spinner loading-xs text-primary"></span> Testando conexão...';
      }

      const res = await window.electronAPI.testAccount({
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        refreshToken: state.refreshToken,
        customerId: targetId,
        loginCustomerId: state.loginCustomerId || undefined,
      });

      if (res.success) {
        if (resultBox) {
          resultBox.innerHTML = `<span class="badge badge-success badge-soft gap-1">✅ ${res.message}</span>`;
        }
        if (nextBtn) nextBtn.disabled = false;
      } else {
        if (resultBox) {
          resultBox.innerHTML = `<span class="badge badge-error badge-soft gap-1">❌ ${res.error}</span>`;
        }
      }
    });
  }

  async function loadAccounts() {
    const loading = document.getElementById('accounts-loading');
    const container = document.getElementById('accounts-container');
    const nextBtn = document.getElementById('btn-next-step4');

    loading?.classList.remove('hidden');
    container?.classList.add('hidden');
    if (container) container.innerHTML = '';

    try {
      const res = await window.electronAPI.listAccounts({
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        refreshToken: state.refreshToken,
      });

      loading?.classList.add('hidden');

      if (res.success && res.accounts && res.accounts.length) {
        state.accounts = res.accounts;
        container?.classList.remove('hidden');

        res.accounts.forEach((acc, index) => {
          const card = document.createElement('div');
          card.className = `account-card ${index === 0 ? 'selected' : ''}`;
          card.dataset.id = acc.id;

          card.innerHTML = `
            <div class="flex items-center gap-3">
              <input type="radio" name="account-choice" value="${acc.id}" class="radio radio-primary radio-sm" ${index === 0 ? 'checked' : ''} />
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-mono font-bold text-sm text-primary">${acc.formattedId}</span>
                  ${acc.manager ? '<span class="badge badge-warning badge-xs">MCC Gerenciador</span>' : ''}
                </div>
                <div class="text-xs text-base-content/80 mt-0.5">${acc.name}</div>
              </div>
            </div>
            <span class="text-xs text-base-content/50">Selecionar</span>
          `;

          card.addEventListener('click', () => {
            document.querySelectorAll('.account-card').forEach((c) => {
              c.classList.remove('selected');
              const radio = c.querySelector('input[type="radio"]');
              if (radio) radio.checked = false;
            });
            card.classList.add('selected');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;

            state.selectedAccountId = acc.id;
            if (acc.manager) {
              state.loginCustomerId = acc.id;
              const loginInput = document.getElementById('input-login-customer-id');
              if (loginInput) loginInput.value = acc.formattedId;
            }

            if (nextBtn) nextBtn.disabled = false;
          });

          container.appendChild(card);
        });

        // Seleciona a primeira por padrão
        state.selectedAccountId = res.accounts[0].id;
        if (res.accounts[0].manager) {
          state.loginCustomerId = res.accounts[0].id;
          const loginInput = document.getElementById('input-login-customer-id');
          if (loginInput) loginInput.value = res.accounts[0].formattedId;
        }
        if (nextBtn) nextBtn.disabled = false;
      } else {
        container?.classList.remove('hidden');
        if (container) {
          container.innerHTML = `
            <div role="alert" class="alert alert-warning text-xs">
              <span>Nenhuma conta listada automaticamente. Digite o Customer ID de 10 dígitos abaixo.</span>
            </div>
          `;
        }
      }
    } catch (err) {
      loading?.classList.add('hidden');
      container?.classList.remove('hidden');
      if (container) {
        container.innerHTML = `
          <div role="alert" class="alert alert-error text-xs">
            <span>Erro ao listar contas: ${err.message}. Digite o Customer ID manualmente abaixo.</span>
          </div>
        `;
      }
    }
  }

  function validateAndAdvanceStep4() {
    const id = digits(state.selectedAccountId);
    if (!id || id.length !== 10) {
      alert('Selecione ou informe um Customer ID de 10 dígitos.');
      return;
    }
    goToStep(5);
  }

  // ───────────────────────── Passo 5: Opcionais ─────────────────────────

  function setupOptionalStep() {
    const genTokenBtn = document.getElementById('btn-gen-panel-token');
    const tokenInput = document.getElementById('input-panel-token');

    genTokenBtn?.addEventListener('click', () => {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
      if (tokenInput) tokenInput.value = hex;
      state.panelToken = hex;
    });

    document.getElementById('input-allowed-hosts')?.addEventListener('input', (e) => {
      state.allowedHosts = e.target.value.trim();
    });

    document.getElementById('input-anthropic-key')?.addEventListener('input', (e) => {
      state.anthropicKey = e.target.value.trim();
    });

    tokenInput?.addEventListener('input', (e) => {
      state.panelToken = e.target.value.trim();
    });
  }

  async function saveAndAdvanceStep5() {
    // Monta o patch de configuração
    const patch = {
      GOOGLE_ADS_CLIENT_ID: state.clientId,
      GOOGLE_ADS_CLIENT_SECRET: state.clientSecret,
      GOOGLE_ADS_CUSTOMER_ID: digits(state.selectedAccountId),
    };

    if (state.refreshToken && state.refreshToken !== 'EXISTING') {
      patch.GOOGLE_ADS_REFRESH_TOKEN = state.refreshToken;
    }

    if (state.loginCustomerId) {
      patch.GOOGLE_ADS_LOGIN_CUSTOMER_ID = digits(state.loginCustomerId);
    }

    if (state.allowedHosts) {
      patch.PAGE_AUDIT_ALLOWED_HOSTS = state.allowedHosts;
    }

    if (state.anthropicKey) {
      patch.ANTHROPIC_API_KEY = state.anthropicKey;
    }

    if (state.panelToken) {
      patch.PANEL_ACCESS_TOKEN = state.panelToken;
    }

    try {
      const res = await window.electronAPI.saveConfig(patch);
      if (!res.success) throw new Error(res.error || 'Erro ao gravar server/.env');
      goToStep(6);
    } catch (err) {
      alert(`Falha ao gravar arquivo de configuração: ${err.message}`);
    }
  }

  // ───────────────────────── Passo 6: Diagnóstico e Conclusão ─────────────────────────

  function setupCompletionStep() {
    document.getElementById('btn-launch-desktop')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-launch-desktop');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loading loading-spinner loading-md"></span> Iniciando OpenAds...';
      }
      await window.electronAPI.launchDashboard();
    });

    document.getElementById('btn-open-external-browser')?.addEventListener('click', () => {
      window.electronAPI.openExternal('http://localhost:4200');
    });
  }

  async function runFinalValidation() {
    const container = document.getElementById('doctor-checklist-container');
    const summaryId = document.getElementById('summary-account-id');
    const summaryName = document.getElementById('summary-account-name');

    if (summaryId) summaryId.textContent = fmtId(state.selectedAccountId);
    const chosenAcc = state.accounts?.find((a) => digits(a.id) === digits(state.selectedAccountId));
    if (summaryName) summaryName.textContent = chosenAcc?.name || 'Conta Google Ads ativa';

    if (container) {
      container.innerHTML = `
        <div class="flex items-center gap-2 py-2">
          <span class="loading loading-spinner loading-sm text-primary"></span>
          <span class="text-xs">Executando diagnóstico final do sistema...</span>
        </div>
      `;
    }

    try {
      const checks = await window.electronAPI.runDoctor();
      if (container) {
        container.innerHTML = '';
        checks.forEach((c) => {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between text-xs py-1.5 border-b border-base-300 last:border-0';
          row.innerHTML = `
            <div class="flex items-center gap-2">
              <span class="${c.passed ? 'text-success' : 'text-error'} font-bold">${c.passed ? '✅' : '❌'}</span>
              <span>${c.label}</span>
            </div>
            <div>
              <span class="badge ${c.passed ? 'badge-success badge-soft' : 'badge-error badge-soft'} text-[11px]">
                ${c.passed ? 'Aprovado' : 'Atenção'}
              </span>
            </div>
          `;
          container.appendChild(row);
        });
      }
    } catch (err) {
      if (container) {
        container.innerHTML = `<span class="text-xs text-error">Erro no diagnóstico: ${err.message}</span>`;
      }
    }
  }

  // ───────────────────────── Modais Auxiliares ─────────────────────────

  function setupModals() {
    // Modal Diagnóstico
    document.getElementById('btn-nav-doctor')?.addEventListener('click', openDoctorModal);
    document.getElementById('btn-run-doctor-again')?.addEventListener('click', executeDoctorChecks);

    // Modal Ajuda
    document.getElementById('btn-nav-help')?.addEventListener('click', openHelpModal);
    document.getElementById('btn-open-full-install-guide')?.addEventListener('click', () => {
      window.electronAPI.openExternal('https://github.com/skroski/open-ads/blob/main/INSTALL.md');
    });

    // Modal Apoio
    document.getElementById('btn-nav-donation')?.addEventListener('click', openDonationModal);
    document.getElementById('btn-copy-pix')?.addEventListener('click', () => {
      const key = document.getElementById('donation-pix-key')?.textContent?.trim() || '41999865410';
      navigator.clipboard.writeText(key);
      const copyBtn = document.getElementById('btn-copy-pix');
      if (copyBtn) {
        copyBtn.textContent = 'Copiado! ✓';
        setTimeout(() => (copyBtn.textContent = 'Copiar Chave'), 2000);
      }
    });

    document.getElementById('btn-open-whatsapp')?.addEventListener('click', () => {
      window.electronAPI.openExternal('https://wa.me/5541999865410?text=Ol%C3%A1!%20Gostaria%20de%20saber%20mais%20sobre%20o%20OpenAds.');
    });

    // Torna funções globais para o menu Electron acionar
    window.openDoctorModal = openDoctorModal;
    window.openDonationModal = openDonationModal;
    window.openHelpModal = openHelpModal;
  }

  function openDoctorModal() {
    const modal = document.getElementById('modal-doctor');
    if (modal) {
      modal.showModal();
      executeDoctorChecks();
    }
  }

  async function executeDoctorChecks() {
    const list = document.getElementById('modal-doctor-results');
    if (!list) return;

    list.innerHTML = `
      <div class="flex items-center gap-2 py-4">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span class="text-xs">Realizando verificações no sistema...</span>
      </div>
    `;

    try {
      const checks = await window.electronAPI.runDoctor();
      list.innerHTML = '';
      checks.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'p-3 rounded-lg bg-base-200 border border-base-300 flex items-start justify-between gap-3 text-xs';
        item.innerHTML = `
          <div>
            <div class="font-bold flex items-center gap-1.5">
              <span>${c.passed ? '✅' : '❌'}</span>
              <span>${c.label}</span>
            </div>
            ${c.detail ? `<div class="text-base-content/70 mt-1">${c.detail}</div>` : ''}
            ${c.fix ? `<div class="text-warning mt-1 font-mono text-[11px]">→ ${c.fix}</div>` : ''}
          </div>
          <span class="badge ${c.passed ? 'badge-success badge-soft' : 'badge-error badge-soft'} shrink-0 text-[11px]">
            ${c.passed ? 'OK' : 'Falha'}
          </span>
        `;
        list.appendChild(item);
      });
    } catch (err) {
      list.innerHTML = `<span class="text-xs text-error">Erro ao executar diagnóstico: ${err.message}</span>`;
    }
  }

  function openHelpModal() {
    const modal = document.getElementById('modal-help');
    if (modal) modal.showModal();
  }

  function openDonationModal() {
    const modal = document.getElementById('modal-donation');
    if (modal) modal.showModal();
  }

})();
