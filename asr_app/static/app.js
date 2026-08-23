/**
 * Qwen-Audio ASR Web Platform - Client Application
 * Full interactive frontend controller:
 * - Audio recording with Web Audio API real-time visualizer
 * - Drag-and-drop file upload
 * - Synchronized interactive audio player with sentence tracking
 * - Settings modal & LocalStorage persistence
 * - History drawer & export tools
 */

(function () {
  'use strict';

  // State Management
  const state = {
    authPasscode: sessionStorage.getItem('app_passcode') || localStorage.getItem('app_passcode') || '',
    authRequired: false,

    // Active Provider: 'openrouter' | 'dashscope'
    activeProvider: localStorage.getItem('asr_active_provider') || 'openrouter',
    openrouterApiKey: localStorage.getItem('asr_openrouter_api_key') || (localStorage.getItem('asr_api_key') && localStorage.getItem('asr_api_key').startsWith('sk-or-') ? localStorage.getItem('asr_api_key') : ''),
    dashscopeApiKey: localStorage.getItem('asr_dashscope_api_key') || localStorage.getItem('dashscope_api_key') || (localStorage.getItem('asr_api_key') && !localStorage.getItem('asr_api_key').startsWith('sk-or-') ? localStorage.getItem('asr_api_key') : ''),
    dashscopeBaseUrl: localStorage.getItem('asr_dashscope_base_url') || localStorage.getItem('asr_base_url') || '',

    openrouterModel: localStorage.getItem('asr_openrouter_model') || 'qwen/qwen3-asr-flash-2026-02-10',
    dashscopeModel: localStorage.getItem('asr_dashscope_model') || 'qwen-audio-3.0-asr-flash-filetrans',

    // Unified active parameters for requests
    apiKey: '',
    baseUrl: '',
    model: 'qwen/qwen3-asr-flash-2026-02-10',

    languageHints: JSON.parse(localStorage.getItem('asr_lang_hints') || localStorage.getItem('dashscope_lang_hints') || '["zh"]'),
    diarization: localStorage.getItem('asr_diarization') === 'true',
    speakerCount: localStorage.getItem('asr_speaker_count') || '',
    disfluency: localStorage.getItem('asr_disfluency') !== 'false',
    alignTimestamps: localStorage.getItem('asr_align_timestamps') !== 'false',
    prompt: localStorage.getItem('asr_prompt') || '',

    // Active media
    activeMode: 'record', // 'record' | 'upload'
    recordedBlob: null,
    uploadedFile: null,
    activeAudioUrl: null,
    currentSessionId: null,
    currentTaskId: null,
    currentTranscriptData: null,

    // Recorder
    mediaRecorder: null,
    audioChunks: [],
    recordStartTime: 0,
    recordTimerInterval: null,
    isRecording: false,
    isPaused: false,
    audioContext: null,
    analyser: null,
    animationFrameId: null,

    // Polling
    pollInterval: null,
    pollStartTime: 0,
  };

  function syncActiveState() {
    // If activeProvider is explicitly dashscope, or if the current model is a known DashScope model
    const dsModels = [
      'qwen-audio-3.0-asr-flash-filetrans',
      'qwen3-asr-flash-filetrans',
      'qwen-audio-asr',
      'sensevoice-v1',
      'paraformer-v2',
      'paraformer-8k-v2',
    ];
    const isDs = state.activeProvider === 'dashscope' || (state.model && dsModels.some(m => state.model.startsWith(m)));

    if (!isDs) {
      state.activeProvider = 'openrouter';
      state.apiKey = state.openrouterApiKey;
      state.model = state.openrouterModel || 'qwen/qwen3-asr-flash-2026-02-10';
      state.baseUrl = '';
    } else {
      state.activeProvider = 'dashscope';
      state.apiKey = state.dashscopeApiKey;
      state.model = state.dashscopeModel || 'qwen-audio-3.0-asr-flash-filetrans';
      state.baseUrl = state.dashscopeBaseUrl;
    }
  }

  // Initial synchronization
  syncActiveState();

  // DOM Elements
  const el = {
    // Header & Auth
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    setupBtnLabel: document.getElementById('setupBtnLabel'),
    setupStatusDot: document.getElementById('setupStatusDot'),
    toggleHistoryBtn: document.getElementById('toggleHistoryBtn'),
    lockAppBtn: document.getElementById('lockAppBtn'),
    loginModal: document.getElementById('loginModal'),
    loginForm: document.getElementById('loginForm'),
    loginPasscodeInput: document.getElementById('loginPasscodeInput'),
    toggleLoginPasscodeVisibility: document.getElementById('toggleLoginPasscodeVisibility'),
    submitLoginBtn: document.getElementById('submitLoginBtn'),
    loginErrorMsg: document.getElementById('loginErrorMsg'),

    // Top Navigation Tabs
    tabRecordBtn: document.getElementById('tabRecordBtn'),
    tabUploadBtn: document.getElementById('tabUploadBtn'),
    recordPanel: document.getElementById('recordPanel'),
    uploadPanel: document.getElementById('uploadPanel'),

    // Recorder Controls
    visualizerCanvas: document.getElementById('visualizerCanvas'),
    recordingTimer: document.getElementById('recordingTimer'),
    startRecordBtn: document.getElementById('startRecordBtn'),
    recordingActiveActions: document.getElementById('recordingActiveActions'),
    pauseRecordBtn: document.getElementById('pauseRecordBtn'),
    pauseIcon: document.getElementById('pauseIcon'),
    stopRecordBtn: document.getElementById('stopRecordBtn'),
    cancelRecordBtn: document.getElementById('cancelRecordBtn'),
    recordingStatusHint: document.getElementById('recordingStatusHint'),
    recordedPreviewCard: document.getElementById('recordedPreviewCard'),
    recordedAudioPlayer: document.getElementById('recordedAudioPlayer'),
    recordedDurationTag: document.getElementById('recordedDurationTag'),
    transcribeRecordedBtn: document.getElementById('transcribeRecordedBtn'),
    reRecordBtn: document.getElementById('reRecordBtn'),

    // Upload Controls
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    uploadedFileCard: document.getElementById('uploadedFileCard'),
    uploadedFileName: document.getElementById('uploadedFileName'),
    uploadedFileSize: document.getElementById('uploadedFileSize'),
    uploadedAudioPlayer: document.getElementById('uploadedAudioPlayer'),
    removeFileBtn: document.getElementById('removeFileBtn'),
    transcribeUploadedBtn: document.getElementById('transcribeUploadedBtn'),

    // Progress
    processingCard: document.getElementById('processingCard'),
    progressTitle: document.getElementById('progressTitle'),
    progressSubtitle: document.getElementById('progressSubtitle'),
    progressBarFill: document.getElementById('progressBarFill'),
    progressTaskId: document.getElementById('progressTaskId'),
    progressTimer: document.getElementById('progressTimer'),

    // Error
    errorBanner: document.getElementById('errorBanner'),
    errorMessage: document.getElementById('errorMessage'),
    closeErrorBtn: document.getElementById('closeErrorBtn'),

    // Results Section
    resultsSection: document.getElementById('resultsSection'),
    globalSyncAudio: document.getElementById('globalSyncAudio'),
    playerPlayBtn: document.getElementById('playerPlayBtn'),
    playerPlayIcon: document.getElementById('playerPlayIcon'),
    playerPauseIcon: document.getElementById('playerPauseIcon'),
    playerCurrentTime: document.getElementById('playerCurrentTime'),
    playerTotalTime: document.getElementById('playerTotalTime'),
    playerScrubber: document.getElementById('playerScrubber'),
    nowPlayingSentence: document.getElementById('nowPlayingSentence'),
    playbackSpeedSelect: document.getElementById('playbackSpeedSelect'),

    // Views
    viewDialogueBtn: document.getElementById('viewDialogueBtn'),
    viewDocumentBtn: document.getElementById('viewDocumentBtn'),
    viewSrtBtn: document.getElementById('viewSrtBtn'),
    viewJsonBtn: document.getElementById('viewJsonBtn'),
    dialogueViewPane: document.getElementById('dialogueViewPane'),
    documentViewPane: document.getElementById('documentViewPane'),
    srtViewPane: document.getElementById('srtViewPane'),
    jsonViewPane: document.getElementById('jsonViewPane'),

    sentenceList: document.getElementById('sentenceList'),
    fullDocumentText: document.getElementById('fullDocumentText'),
    srtCodeBlock: document.getElementById('srtCodeBlock'),
    jsonCodeBlock: document.getElementById('jsonCodeBlock'),
    transcriptSearchInput: document.getElementById('transcriptSearchInput'),

    // Meta
    metaModelName: document.getElementById('metaModelName'),
    metaDuration: document.getElementById('metaDuration'),
    metaSentenceCount: document.getElementById('metaSentenceCount'),
    metaCharCount: document.getElementById('metaCharCount'),

    // Export
    exportDropdownBtn: document.getElementById('exportDropdownBtn'),
    exportMenu: document.getElementById('exportMenu'),
    copyAllTextBtn: document.getElementById('copyAllTextBtn'),

    // Settings Modal Tabs
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    tabBtnOpenRouter: document.getElementById('tabBtnOpenRouter'),
    tabBtnAlibaba: document.getElementById('tabBtnAlibaba'),
    tabBtnPreferences: document.getElementById('tabBtnPreferences'),
    paneOpenRouter: document.getElementById('paneOpenRouter'),
    paneAlibaba: document.getElementById('paneAlibaba'),
    panePreferences: document.getElementById('panePreferences'),
    dotOpenRouter: document.getElementById('dotOpenRouter'),
    dotAlibaba: document.getElementById('dotAlibaba'),
    bannerCardOpenRouter: document.getElementById('bannerCardOpenRouter'),
    bannerCardAlibaba: document.getElementById('bannerCardAlibaba'),
    radioProviderOpenRouter: document.getElementById('radioProviderOpenRouter'),
    radioProviderDashScope: document.getElementById('radioProviderDashScope'),
    labelProviderOpenRouter: document.getElementById('labelProviderOpenRouter'),
    labelProviderDashScope: document.getElementById('labelProviderDashScope'),

    // OpenRouter Settings
    settingOpenRouterApiKey: document.getElementById('settingOpenRouterApiKey'),
    toggleOpenRouterKeyVisibilityBtn: document.getElementById('toggleOpenRouterKeyVisibilityBtn'),
    testOpenRouterKeyBtn: document.getElementById('testOpenRouterKeyBtn'),
    openRouterKeyValidationResult: document.getElementById('openRouterKeyValidationResult'),
    settingOpenRouterModel: document.getElementById('settingOpenRouterModel'),
    refreshOpenRouterModelsBtn: document.getElementById('refreshOpenRouterModelsBtn'),
    settingOpenRouterCustomModel: document.getElementById('settingOpenRouterCustomModel'),

    // Alibaba Cloud DashScope Settings
    settingDashScopeApiKey: document.getElementById('settingDashScopeApiKey'),
    toggleDashScopeKeyVisibilityBtn: document.getElementById('toggleDashScopeKeyVisibilityBtn'),
    testDashScopeKeyBtn: document.getElementById('testDashScopeKeyBtn'),
    dashScopeKeyValidationResult: document.getElementById('dashScopeKeyValidationResult'),
    settingDashScopeBaseUrl: document.getElementById('settingDashScopeBaseUrl'),
    settingDashScopeModel: document.getElementById('settingDashScopeModel'),
    settingDashScopeCustomModel: document.getElementById('settingDashScopeCustomModel'),

    // Preferences Settings
    langChipsContainer: document.getElementById('langChipsContainer'),
    settingDiarization: document.getElementById('settingDiarization'),
    speakerCountGroup: document.getElementById('speakerCountGroup'),
    settingSpeakerCount: document.getElementById('settingSpeakerCount'),
    settingDisfluency: document.getElementById('settingDisfluency'),
    settingAlignTimestamps: document.getElementById('settingAlignTimestamps'),
    settingPrompt: document.getElementById('settingPrompt'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    resetSettingsBtn: document.getElementById('resetSettingsBtn'),

    // History Drawer
    historyDrawer: document.getElementById('historyDrawer'),
    closeHistoryBtn: document.getElementById('closeHistoryBtn'),
    clearAllHistoryBtn: document.getElementById('clearAllHistoryBtn'),
    historyCountBadge: document.getElementById('historyCountBadge'),
    historyList: document.getElementById('historyList'),

    // Toast
    toastNotification: document.getElementById('toastNotification'),
  };

  // ==========================================================================
  // API Fetch with Auth Headers
  // ==========================================================================

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.authPasscode) {
      headers['Authorization'] = `Bearer ${state.authPasscode}`;
      headers['X-App-Passcode'] = state.authPasscode;
    }
    const mergedOptions = { ...options, headers };
    const resp = await fetch(url, mergedOptions);

    if (resp.status === 401) {
      try {
        const cloned = await resp.clone().json();
        if (cloned.auth_required) {
          state.authRequired = true;
          showLoginModal();
        }
      } catch (e) {
        showLoginModal();
      }
    }
    return resp;
  }

  // ==========================================================================
  // Initialization & Auth
  // ==========================================================================

  async function init() {
    setupEventListeners();
    initVisualizerCanvas();
    await checkAuthStatus();
    loadServerConfig();
    updateUIHeader();
  }

  async function checkAuthStatus() {
    try {
      const resp = await fetch('/api/auth/status');
      if (resp.ok) {
        const data = await resp.json();
        state.authRequired = Boolean(data.auth_required);
        if (state.authRequired) {
          if (el.lockAppBtn) el.lockAppBtn.classList.remove('hidden');
          if (!data.authenticated) {
            showLoginModal();
          }
        }
      }
    } catch (e) {
      console.warn('Auth status check error:', e);
    }
  }

  function showLoginModal() {
    if (el.loginModal) {
      el.loginModal.classList.remove('hidden');
      if (el.loginPasscodeInput) {
        el.loginPasscodeInput.value = '';
        el.loginPasscodeInput.focus();
      }
      if (el.loginErrorMsg) el.loginErrorMsg.classList.add('hidden');
    }
  }

  function hideLoginModal() {
    if (el.loginModal) {
      el.loginModal.classList.add('hidden');
    }
  }

  async function handleLoginSubmit(e) {
    if (e) e.preventDefault();
    const passcode = el.loginPasscodeInput ? el.loginPasscodeInput.value.trim() : '';
    if (!passcode) {
      if (el.loginErrorMsg) {
        el.loginErrorMsg.textContent = '请输入访问 Passcode';
        el.loginErrorMsg.classList.remove('hidden');
      }
      return;
    }

    try {
      if (el.submitLoginBtn) el.submitLoginBtn.disabled = true;
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = await resp.json();

      if (resp.ok && data.success) {
        state.authPasscode = passcode;
        sessionStorage.setItem('app_passcode', passcode);
        localStorage.setItem('app_passcode', passcode);
        hideLoginModal();
        showToast('🔓 访问权限验证成功');
        loadServerConfig();
        loadHistoryList();
      } else {
        if (el.loginErrorMsg) {
          el.loginErrorMsg.textContent = data.error || 'Passcode 验证失败，请重试';
          el.loginErrorMsg.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (el.loginErrorMsg) {
        el.loginErrorMsg.textContent = '网络连接错误，请检查服务状态';
        el.loginErrorMsg.classList.remove('hidden');
      }
    } finally {
      if (el.submitLoginBtn) el.submitLoginBtn.disabled = false;
    }
  }

  function lockApp() {
    state.authPasscode = '';
    sessionStorage.removeItem('app_passcode');
    localStorage.removeItem('app_passcode');
    showLoginModal();
    showToast('🔒 会话已锁定');
  }

  async function loadServerConfig() {
    try {
      const resp = await apiFetch('/api/config');
      if (resp.ok) {
        const config = await resp.json();
        if (config.has_openrouter_key && !state.openrouterApiKey) {
          state.openrouterApiKey = config.masked_openrouter_key || 'configured_in_env';
        }
        if (config.has_dashscope_key && !state.dashscopeApiKey) {
          state.dashscopeApiKey = config.masked_dashscope_key || 'configured_in_env';
        }
        if (config.dashscope_base_url && !state.dashscopeBaseUrl) {
          state.dashscopeBaseUrl = config.dashscope_base_url;
        }
        syncActiveState();
        updateUIHeader();
      }
    } catch (e) {
      console.warn('Could not fetch server config:', e);
    }
  }

  function updateProviderBanners() {
    const isOr = state.activeProvider === 'openrouter';
    if (el.bannerCardOpenRouter) {
      el.bannerCardOpenRouter.classList.toggle('active-provider', isOr);
    }
    if (el.bannerCardAlibaba) {
      el.bannerCardAlibaba.classList.toggle('active-provider', !isOr);
    }
    if (el.labelProviderOpenRouter) {
      el.labelProviderOpenRouter.textContent = isOr ? '当前使用中' : '设为当前使用';
    }
    if (el.labelProviderDashScope) {
      el.labelProviderDashScope.textContent = !isOr ? '当前使用中' : '设为当前使用';
    }
    if (el.radioProviderOpenRouter) el.radioProviderOpenRouter.checked = isOr;
    if (el.radioProviderDashScope) el.radioProviderDashScope.checked = !isOr;
    if (el.dotOpenRouter) el.dotOpenRouter.classList.toggle('hidden', !isOr);
    if (el.dotAlibaba) el.dotAlibaba.classList.toggle('hidden', isOr);
  }

  function updateUIHeader() {
    syncActiveState();
    const hasKey = Boolean(state.apiKey && state.apiKey.length > 3);
    const shortModel = state.model.split('/').pop().replace('-filetrans', '');
    if (el.setupBtnLabel) {
      el.setupBtnLabel.textContent = `设置 (${shortModel})`;
    }
    if (el.setupStatusDot) {
      el.setupStatusDot.classList.toggle('active', hasKey);
      el.setupStatusDot.title = hasKey ? `API Key 已配置 (${state.activeProvider})` : 'API Key 未配置，点击设置';
    }

    updateProviderBanners();
  }

  function showToast(message, duration = 3000) {
    el.toastNotification.textContent = message;
    el.toastNotification.classList.remove('hidden');
    setTimeout(() => {
      el.toastNotification.classList.add('hidden');
    }, duration);
  }

  function showError(msg) {
    el.errorMessage.textContent = msg;
    el.errorBanner.classList.remove('hidden');
    el.errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    el.errorBanner.classList.add('hidden');
  }

  // ==========================================================================
  // Event Listeners
  // ==========================================================================

  function setupEventListeners() {
    // Auth & Lock
    if (el.lockAppBtn) el.lockAppBtn.addEventListener('click', lockApp);
    if (el.loginForm) el.loginForm.addEventListener('submit', handleLoginSubmit);
    if (el.submitLoginBtn) el.submitLoginBtn.addEventListener('click', handleLoginSubmit);
    if (el.toggleLoginPasscodeVisibility) {
      el.toggleLoginPasscodeVisibility.addEventListener('click', () => {
        if (el.loginPasscodeInput) {
          const isPass = el.loginPasscodeInput.type === 'password';
          el.loginPasscodeInput.type = isPass ? 'text' : 'password';
        }
      });
    }

    // Mode Tabs
    if (el.tabRecordBtn) el.tabRecordBtn.addEventListener('click', () => switchTab('record'));
    if (el.tabUploadBtn) el.tabUploadBtn.addEventListener('click', () => switchTab('upload'));

    // Recorder Controls
    if (el.startRecordBtn) el.startRecordBtn.addEventListener('click', startRecording);
    if (el.pauseRecordBtn) el.pauseRecordBtn.addEventListener('click', togglePauseRecording);
    if (el.stopRecordBtn) el.stopRecordBtn.addEventListener('click', stopRecording);
    if (el.cancelRecordBtn) el.cancelRecordBtn.addEventListener('click', cancelRecording);
    if (el.reRecordBtn) el.reRecordBtn.addEventListener('click', cancelRecording);
    if (el.transcribeRecordedBtn) el.transcribeRecordedBtn.addEventListener('click', () => submitTranscription('record'));

    // File Upload
    if (el.dropZone) {
      el.dropZone.addEventListener('dragover', handleDragOver);
      el.dropZone.addEventListener('dragleave', handleDragLeave);
      el.dropZone.addEventListener('drop', handleFileDrop);
    }
    if (el.fileInput) el.fileInput.addEventListener('change', handleFileSelect);
    if (el.removeFileBtn) el.removeFileBtn.addEventListener('click', clearUploadedFile);
    if (el.transcribeUploadedBtn) el.transcribeUploadedBtn.addEventListener('click', () => submitTranscription('upload'));

    // Error Close
    if (el.closeErrorBtn) el.closeErrorBtn.addEventListener('click', hideError);

    // Synchronized Player Controls
    if (el.playerPlayBtn) el.playerPlayBtn.addEventListener('click', togglePlayAudio);
    if (el.playerScrubber) el.playerScrubber.addEventListener('input', handleScrubberSeek);
    if (el.playbackSpeedSelect) {
      el.playbackSpeedSelect.addEventListener('change', (e) => {
        if (el.globalSyncAudio) el.globalSyncAudio.playbackRate = parseFloat(e.target.value);
      });
    }
    if (el.globalSyncAudio) {
      el.globalSyncAudio.addEventListener('timeupdate', handleAudioTimeUpdate);
      el.globalSyncAudio.addEventListener('ended', handleAudioEnded);
      el.globalSyncAudio.addEventListener('play', () => {
        if (el.playerPlayIcon) el.playerPlayIcon.classList.add('hidden');
        if (el.playerPauseIcon) el.playerPauseIcon.classList.remove('hidden');
      });
      el.globalSyncAudio.addEventListener('pause', () => {
        if (el.playerPlayIcon) el.playerPlayIcon.classList.remove('hidden');
        if (el.playerPauseIcon) el.playerPauseIcon.classList.add('hidden');
      });
    }

    // Transcript Views Switcher
    if (el.viewDialogueBtn) el.viewDialogueBtn.addEventListener('click', () => switchTranscriptView('dialogue'));
    if (el.viewDocumentBtn) el.viewDocumentBtn.addEventListener('click', () => switchTranscriptView('document'));
    if (el.viewSrtBtn) el.viewSrtBtn.addEventListener('click', () => switchTranscriptView('srt'));
    if (el.viewJsonBtn) el.viewJsonBtn.addEventListener('click', () => switchTranscriptView('json'));

    // Search
    if (el.transcriptSearchInput) el.transcriptSearchInput.addEventListener('input', handleSearch);

    // Export Dropdown
    if (el.exportDropdownBtn) {
      el.exportDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.exportMenu) el.exportMenu.classList.toggle('hidden');
      });
    }
    document.addEventListener('click', () => {
      if (el.exportMenu) el.exportMenu.classList.add('hidden');
    });
    if (el.exportMenu) {
      el.exportMenu.querySelectorAll('[data-export]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const fmt = btn.getAttribute('data-export');
          exportTranscript(fmt);
        });
      });
    }
    if (el.copyAllTextBtn) el.copyAllTextBtn.addEventListener('click', copyFullText);

    // Settings Modal
    if (el.openSettingsBtn) el.openSettingsBtn.addEventListener('click', openSettingsModal);
    if (el.closeSettingsBtn) el.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    if (el.settingsModal) {
      el.settingsModal.addEventListener('click', (e) => {
        if (e.target === el.settingsModal) closeSettingsModal();
      });
    }

    // Tab Navigation
    if (el.tabBtnOpenRouter) el.tabBtnOpenRouter.addEventListener('click', () => switchSettingsTab('openrouter'));
    if (el.tabBtnAlibaba) el.tabBtnAlibaba.addEventListener('click', () => switchSettingsTab('alibaba'));
    if (el.tabBtnPreferences) el.tabBtnPreferences.addEventListener('click', () => switchSettingsTab('preferences'));

    // Provider Radios
    if (el.radioProviderOpenRouter) {
      el.radioProviderOpenRouter.addEventListener('change', (e) => {
        if (e.target.checked) setActiveProvider('openrouter');
      });
    }
    if (el.radioProviderDashScope) {
      el.radioProviderDashScope.addEventListener('change', (e) => {
        if (e.target.checked) setActiveProvider('dashscope');
      });
    }

    // OpenRouter Key & Model
    if (el.toggleOpenRouterKeyVisibilityBtn) el.toggleOpenRouterKeyVisibilityBtn.addEventListener('click', toggleOpenRouterKeyVisibility);
    if (el.testOpenRouterKeyBtn) el.testOpenRouterKeyBtn.addEventListener('click', testOpenRouterKey);
    if (el.refreshOpenRouterModelsBtn) el.refreshOpenRouterModelsBtn.addEventListener('click', refreshOpenRouterModels);
    if (el.settingOpenRouterModel) el.settingOpenRouterModel.addEventListener('change', handleOpenRouterModelChange);

    // DashScope Key & Model
    if (el.toggleDashScopeKeyVisibilityBtn) el.toggleDashScopeKeyVisibilityBtn.addEventListener('click', toggleDashScopeKeyVisibility);
    if (el.testDashScopeKeyBtn) el.testDashScopeKeyBtn.addEventListener('click', testDashScopeKey);
    if (el.settingDashScopeModel) el.settingDashScopeModel.addEventListener('change', handleDashScopeModelChange);

    // Preferences & Toggles
    if (el.settingDiarization) {
      el.settingDiarization.addEventListener('change', (e) => {
        if (el.speakerCountGroup) el.speakerCountGroup.classList.toggle('hidden', !e.target.checked);
      });
    }
    if (el.saveSettingsBtn) el.saveSettingsBtn.addEventListener('click', saveSettings);
    if (el.resetSettingsBtn) el.resetSettingsBtn.addEventListener('click', resetSettings);

    // Endpoint preset tags
    document.querySelectorAll('.preset-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (el.settingDashScopeBaseUrl && btn.dataset.url) {
          el.settingDashScopeBaseUrl.value = btn.dataset.url;
          el.settingDashScopeBaseUrl.focus();
        }
      });
    });

    // History Drawer
    if (el.toggleHistoryBtn) el.toggleHistoryBtn.addEventListener('click', openHistoryDrawer);
    if (el.closeHistoryBtn) el.closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
    if (el.clearAllHistoryBtn) {
      el.clearAllHistoryBtn.addEventListener('click', clearAllHistory);
    }
    if (el.historyDrawer) {
      el.historyDrawer.addEventListener('click', (e) => {
        if (e.target === el.historyDrawer) closeHistoryDrawer();
      });
    }
  }

  function switchTab(mode) {
    state.activeMode = mode;
    hideError();
    if (mode === 'record') {
      el.tabRecordBtn.classList.add('active');
      el.tabUploadBtn.classList.remove('active');
      el.recordPanel.classList.add('active');
      el.uploadPanel.classList.remove('active');
    } else {
      el.tabRecordBtn.classList.remove('active');
      el.tabUploadBtn.classList.add('active');
      el.recordPanel.classList.remove('active');
      el.uploadPanel.classList.add('active');
    }
  }

  // ==========================================================================
  // Microphone Recording & Audio Visualizer
  // ==========================================================================

  function initVisualizerCanvas() {
    const canvas = el.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw subtle idle centerline
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }

  async function startRecording() {
    hideError();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // AudioContext for Visualizer
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = state.audioContext.createMediaStreamSource(stream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;
      source.connect(state.analyser);

      // MediaRecorder options
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg', 'audio/wav'];
      let chosenMime = '';
      for (const m of mimeTypes) {
        if (MediaRecorder.isTypeSupported(m)) {
          chosenMime = m;
          break;
        }
      }

      state.audioChunks = [];
      state.mediaRecorder = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);

      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          state.audioChunks.push(e.data);
        }
      };

      state.mediaRecorder.onstop = () => {
        const mime = state.mediaRecorder.mimeType || 'audio/wav';
        state.recordedBlob = new Blob(state.audioChunks, { type: mime });
        const audioUrl = URL.createObjectURL(state.recordedBlob);
        state.activeAudioUrl = audioUrl;

        el.recordedAudioPlayer.src = audioUrl;
        el.recordedPreviewCard.classList.remove('hidden');
        el.recordingStatusHint.textContent = '录音已就绪，可预览或直接提交转写';
        el.startRecordBtn.classList.remove('recording');

        // Stop stream tracks
        stream.getTracks().forEach((t) => t.stop());
        if (state.audioContext && state.audioContext.state !== 'closed') {
          state.audioContext.close();
        }
        cancelAnimationFrame(state.animationFrameId);
        initVisualizerCanvas();
      };

      state.mediaRecorder.start(100);
      state.isRecording = true;
      state.isPaused = false;
      state.recordStartTime = Date.now();

      // UI updates
      el.startRecordBtn.classList.add('recording');
      el.startRecordBtn.classList.add('hidden');
      el.recordingActiveActions.classList.remove('hidden');
      el.recordedPreviewCard.classList.add('hidden');
      el.recordingStatusHint.textContent = '🎙️ 正在录音中... 说话声音将被实时采集';

      // Start timer
      clearInterval(state.recordTimerInterval);
      state.recordTimerInterval = setInterval(updateRecordTimer, 50);

      // Start waveform animation
      drawVisualizerWaveform();
    } catch (err) {
      console.error('Microphone access error:', err);
      showError('无法访问麦克风。请检查浏览器权限设置，并确保麦克风设备正常。');
    }
  }

  function togglePauseRecording() {
    if (!state.mediaRecorder) return;
    if (!state.isPaused) {
      state.mediaRecorder.pause();
      state.isPaused = true;
      el.pauseIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
      el.recordingStatusHint.textContent = '⏸️ 录音已暂停';
    } else {
      state.mediaRecorder.resume();
      state.isPaused = false;
      el.pauseIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
      el.recordingStatusHint.textContent = '🎙️ 正在录音中...';
    }
  }

  function stopRecording() {
    if (state.mediaRecorder && state.isRecording) {
      state.mediaRecorder.stop();
      state.isRecording = false;
      state.isPaused = false;
      clearInterval(state.recordTimerInterval);
      el.recordingActiveActions.classList.add('hidden');
      el.startRecordBtn.classList.remove('hidden');
      el.startRecordBtn.classList.remove('recording');
    }
  }

  function cancelRecording() {
    if (state.mediaRecorder && state.isRecording) {
      state.mediaRecorder.onstop = null; // discard
      state.mediaRecorder.stop();
      state.isRecording = false;
      state.isPaused = false;
    }
    clearInterval(state.recordTimerInterval);
    cancelAnimationFrame(state.animationFrameId);
    if (state.audioContext && state.audioContext.state !== 'closed') {
      state.audioContext.close();
    }
    state.recordedBlob = null;
    state.activeAudioUrl = null;
    el.recordingTimer.textContent = '00:00.00';
    el.recordingActiveActions.classList.add('hidden');
    el.startRecordBtn.classList.remove('hidden');
    el.startRecordBtn.classList.remove('recording');
    el.recordedPreviewCard.classList.add('hidden');
    el.recordingStatusHint.textContent = '点击麦克风按钮开始清晰捕捉您的语音';
    initVisualizerCanvas();
  }

  function updateRecordTimer() {
    if (state.isPaused) return;
    const elapsed = Date.now() - state.recordStartTime;
    const totalSec = Math.floor(elapsed / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const ms = Math.floor((elapsed % 1000) / 10);
    const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    el.recordingTimer.textContent = timeStr;
    el.recordedDurationTag.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function drawVisualizerWaveform() {
    if (!state.analyser || !state.isRecording) return;
    const canvas = el.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function render() {
      if (!state.isRecording) return;
      state.animationFrameId = requestAnimationFrame(render);
      state.analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 3;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, '#4f46e5');
      gradient.addColorStop(0.5, '#0284c7');
      gradient.addColorStop(1, '#e11d48');
      ctx.strokeStyle = gradient;

      ctx.beginPath();
      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }

    render();
  }

  // ==========================================================================
  // File Upload Handling
  // ==========================================================================

  function handleDragOver(e) {
    e.preventDefault();
    el.dropZone.classList.add('dragover');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    el.dropZone.classList.remove('dragover');
  }

  function handleFileDrop(e) {
    e.preventDefault();
    el.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  }

  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  }

  function processSelectedFile(file) {
    hideError();
    state.uploadedFile = file;
    const url = URL.createObjectURL(file);
    state.activeAudioUrl = url;

    el.uploadedFileName.textContent = file.name;
    el.uploadedFileSize.textContent = formatBytes(file.size);
    el.uploadedAudioPlayer.src = url;

    el.dropZone.classList.add('hidden');
    el.uploadedFileCard.classList.remove('hidden');
  }

  function clearUploadedFile() {
    state.uploadedFile = null;
    state.activeAudioUrl = null;
    el.fileInput.value = '';
    el.dropZone.classList.remove('hidden');
    el.uploadedFileCard.classList.add('hidden');
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ==========================================================================
  // Transcription Submission & Polling
  // ==========================================================================

  async function submitTranscription(mode) {
    hideError();

    let fileToUpload = null;
    let filename = 'recording.wav';

    if (mode === 'record') {
      if (!state.recordedBlob) {
        showError('请先进行录音');
        return;
      }
      fileToUpload = state.recordedBlob;
      filename = `recording_${Date.now()}.wav`;
    } else {
      if (!state.uploadedFile) {
        showError('请先选择或拖拽音频文件');
        return;
      }
      fileToUpload = state.uploadedFile;
      filename = state.uploadedFile.name;
    }

    // Build form data
    const formData = new FormData();
    formData.append('file', fileToUpload, filename);
    formData.append('model', state.model);
    if (state.apiKey && state.apiKey !== 'configured_in_env') {
      formData.append('api_key', state.apiKey);
    }
    if (state.languageHints && state.languageHints.length > 0) {
      formData.append('language_hints', state.languageHints.join(','));
    }
    formData.append('diarization_enabled', state.diarization ? 'true' : 'false');
    if (state.speakerCount) {
      formData.append('speaker_count', state.speakerCount);
    }
    formData.append('disfluency_removal_enabled', state.disfluency ? 'true' : 'false');
    formData.append('timestamp_alignment_enabled', state.alignTimestamps ? 'true' : 'false');
    if (state.prompt) {
      formData.append('prompt', state.prompt);
    }
    if (state.baseUrl) {
      formData.append('base_url', state.baseUrl);
    }

    // UI Loading State
    showProgressCard(state.model);

    try {
      const resp = await apiFetch('/api/transcribe', {
        method: 'POST',
        headers: state.apiKey && state.apiKey !== 'configured_in_env' ? { 'X-DashScope-Api-Key': state.apiKey } : {},
        body: formData,
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || data.message || '转写提交失败');
      }

      state.currentSessionId = data.session_id;
      state.currentTaskId = data.task_id;
      el.progressTaskId.textContent = data.task_id || '-';

      // Set server audio URL for player seeking
      if (data.audio_url) {
        const audioUrl = state.authPasscode ? `${data.audio_url}?token=${encodeURIComponent(state.authPasscode)}` : data.audio_url;
        el.globalSyncAudio.src = audioUrl;
      }

      // If results were returned directly (e.g. OpenRouter)
      if (data.status === 'SUCCEEDED') {
        hideProgressCard();
        renderTranscriptionResults(data);
        showToast('✨ 语音转写完成！');
      } else {
        // Start polling for async tasks (e.g. DashScope)
        startTaskPolling(data.task_id, data.session_id);
      }
    } catch (err) {
      console.error('Transcription error:', err);
      hideProgressCard();
      showError(err.message || '提交转写任务失败，请检查网络或 API Key 设置。');
    }
  }

  function showProgressCard(modelName) {
    el.progressTitle.textContent = `正在使用 ${modelName} 处理录音...`;
    el.progressSubtitle.textContent = '已提交任务至百炼/OpenRouter，正在识别与时间戳对齐...';
    el.progressTaskId.textContent = '正在初始化...';
    el.processingCard.classList.remove('hidden');
    el.resultsSection.classList.add('hidden');

    state.pollStartTime = Date.now();
    updateProgressTimer();
  }

  function hideProgressCard() {
    el.processingCard.classList.add('hidden');
    clearInterval(state.pollInterval);
  }

  function updateProgressTimer() {
    const elapsed = Math.floor((Date.now() - state.pollStartTime) / 1000);
    el.progressTimer.textContent = `耗时: ${elapsed}s`;
  }

  function startTaskPolling(taskId, sessionId) {
    clearInterval(state.pollInterval);
    state.pollInterval = setInterval(async () => {
      updateProgressTimer();
      try {
        const url = `/api/task/${taskId}?session_id=${sessionId || ''}`;
        const headers = state.apiKey && state.apiKey !== 'configured_in_env' ? { 'X-DashScope-Api-Key': state.apiKey } : {};
        const resp = await apiFetch(url, { headers });
        const data = await resp.json();

        if (data.status === 'SUCCEEDED') {
          hideProgressCard();
          renderTranscriptionResults(data);
          showToast('✨ 语音转写完成！');
        } else if (data.status === 'FAILED' || data.status === 'CANCELED') {
          hideProgressCard();
          showError(data.error_message || data.message || '识别任务失败');
        }
      } catch (err) {
        console.warn('Poll error:', err);
      }
    }, 1500);
  }

  // ==========================================================================
  // Render Results & Interactive Synchronized Audio Player
  // ==========================================================================

  function renderTranscriptionResults(data) {
    state.currentTranscriptData = data;
    el.resultsSection.classList.remove('hidden');

    const fullText = data.full_text || '';
    const sentences = data.sentences || [];
    const durationStr = data.duration_str || '00:00';

    // Summary Strip
    el.metaModelName.textContent = data.model || state.model;
    el.metaDuration.textContent = durationStr;
    el.metaSentenceCount.textContent = sentences.length;
    el.metaCharCount.textContent = fullText.length;

    // 1. Dialogue Sentence List
    el.sentenceList.innerHTML = '';
    if (sentences.length === 0 && fullText) {
      // Fallback single block
      const card = document.createElement('div');
      card.className = 'sentence-card';
      card.innerHTML = `<div class="sentence-text">${escapeHtml(fullText)}</div>`;
      el.sentenceList.appendChild(card);
    } else {
      sentences.forEach((s, idx) => {
        const card = document.createElement('div');
        card.className = 'sentence-card';
        card.dataset.index = idx;
        card.dataset.begin = s.begin_time;
        card.dataset.end = s.end_time;

        const speakerBadge = s.speaker_label ? `<span class="speaker-badge">${escapeHtml(s.speaker_label)}</span>` : '';
        const timeBtn = `<button class="sentence-time-btn" title="点击播放">${s.begin_time_str || '00:00'}</button>`;

        card.innerHTML = `
          ${timeBtn}
          <div class="sentence-body">
            <div class="sentence-text">${speakerBadge}${escapeHtml(s.text)}</div>
          </div>
        `;

        // Click on time button or sentence body seeks and plays audio
        card.addEventListener('click', () => {
          seekAudioToMs(s.begin_time);
        });

        el.sentenceList.appendChild(card);
      });
    }

    // 2. Full Document Text
    el.fullDocumentText.textContent = fullText || '（无转写文本）';

    // 3. SRT View
    el.srtCodeBlock.textContent = generateSrtText(sentences);

    // 4. JSON View
    el.jsonCodeBlock.textContent = JSON.stringify(data, null, 2);

    // Initialize Audio Player duration
    el.playerTotalTime.textContent = durationStr;
    el.playerScrubber.value = 0;

    // Scroll to results
    el.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function seekAudioToMs(ms) {
    const sec = ms / 1000;
    el.globalSyncAudio.currentTime = sec;
    el.globalSyncAudio.play();
  }

  function togglePlayAudio() {
    if (el.globalSyncAudio.paused) {
      el.globalSyncAudio.play();
    } else {
      el.globalSyncAudio.pause();
    }
  }

  function handleScrubberSeek(e) {
    const percent = parseFloat(e.target.value);
    if (el.globalSyncAudio.duration) {
      el.globalSyncAudio.currentTime = (percent / 100) * el.globalSyncAudio.duration;
    }
  }

  function handleAudioTimeUpdate() {
    const audio = el.globalSyncAudio;
    const currentSec = audio.currentTime || 0;
    const durationSec = audio.duration || 1;
    const currentMs = currentSec * 1000;

    // Update scrubber & time label
    el.playerCurrentTime.textContent = formatSecToDisplay(currentSec);
    if (audio.duration && !isNaN(audio.duration)) {
      el.playerTotalTime.textContent = formatSecToDisplay(audio.duration);
      el.playerScrubber.value = (currentSec / durationSec) * 100;
    }

    // Highlight matching sentence in Dialogue view
    if (!state.currentTranscriptData || !state.currentTranscriptData.sentences) return;

    const cards = el.sentenceList.querySelectorAll('.sentence-card');
    let activeFound = false;

    cards.forEach((card) => {
      const begin = parseFloat(card.dataset.begin || 0);
      const end = parseFloat(card.dataset.end || 0);

      if (currentMs >= begin && currentMs <= end) {
        if (!card.classList.contains('active')) {
          card.classList.add('active');
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const textElem = card.querySelector('.sentence-text');
          if (textElem) {
            el.nowPlayingSentence.textContent = textElem.textContent;
          }
        }
        activeFound = true;
      } else {
        card.classList.remove('active');
      }
    });

    if (!activeFound && currentMs === 0) {
      el.nowPlayingSentence.textContent = '点击下方任意句子可快速同步跳转播放';
    }
  }

  function handleAudioEnded() {
    el.playerPlayIcon.classList.remove('hidden');
    el.playerPauseIcon.classList.add('hidden');
  }

  function formatSecToDisplay(sec) {
    const totalSec = Math.floor(sec);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ==========================================================================
  // View Switcher & Search
  // ==========================================================================

  function switchTranscriptView(view) {
    el.viewDialogueBtn.classList.toggle('active', view === 'dialogue');
    el.viewDocumentBtn.classList.toggle('active', view === 'document');
    el.viewSrtBtn.classList.toggle('active', view === 'srt');
    el.viewJsonBtn.classList.toggle('active', view === 'json');

    el.dialogueViewPane.classList.toggle('hidden', view !== 'dialogue');
    el.documentViewPane.classList.toggle('hidden', view !== 'document');
    el.srtViewPane.classList.toggle('hidden', view !== 'srt');
    el.jsonViewPane.classList.toggle('hidden', view !== 'json');
  }

  function handleSearch(e) {
    const query = (e.target.value || '').trim().toLowerCase();
    const cards = el.sentenceList.querySelectorAll('.sentence-card');

    cards.forEach((card) => {
      const textElem = card.querySelector('.sentence-text');
      if (!textElem) return;
      const rawText = textElem.textContent;

      if (!query) {
        card.classList.remove('hidden');
        textElem.innerHTML = escapeHtml(rawText);
        return;
      }

      if (rawText.toLowerCase().includes(query)) {
        card.classList.remove('hidden');
        const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
        textElem.innerHTML = rawText.replace(regex, '<mark class="highlight-match">$1</mark>');
      } else {
        card.classList.add('hidden');
      }
    });
  }

  // ==========================================================================
  // Exporters
  // ==========================================================================

  function generateSrtText(sentences) {
    if (!sentences || sentences.length === 0) return '';
    return sentences
      .map((s, idx) => {
        const begin = formatMsToSrt(s.begin_time || 0);
        const end = formatMsToSrt(s.end_time || 0);
        const label = s.speaker_label ? `[${s.speaker_label}] ` : '';
        return `${idx + 1}\n${begin} --> ${end}\n${label}${s.text}\n`;
      })
      .join('\n');
  }

  function formatMsToSrt(ms) {
    const totalSeconds = Math.max(0, ms) / 1000.0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  function copyFullText() {
    if (!state.currentTranscriptData || !state.currentTranscriptData.full_text) {
      showToast('暂无可复制内容');
      return;
    }
    navigator.clipboard.writeText(state.currentTranscriptData.full_text).then(() => {
      showToast('📋 全文已成功复制至剪贴板！');
    });
  }

  function exportTranscript(format) {
    if (!state.currentSessionId && !state.currentTranscriptData) {
      showToast('暂无可导出内容');
      return;
    }

    if (state.currentSessionId) {
      const tokenQuery = state.authPasscode ? `?token=${encodeURIComponent(state.authPasscode)}` : '';
      window.location.href = `/api/export/${state.currentSessionId}/${format}${tokenQuery}`;
      showToast(`正在下载 .${format} 文件...`);
    } else {
      // Local client fallback
      let blob, filename;
      const fullText = state.currentTranscriptData.full_text || '';
      const sentences = state.currentTranscriptData.sentences || [];

      if (format === 'txt') {
        blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        filename = 'transcript.txt';
      } else if (format === 'srt') {
        blob = new Blob([generateSrtText(sentences)], { type: 'text/plain;charset=utf-8' });
        filename = 'transcript.srt';
      } else if (format === 'json') {
        blob = new Blob([JSON.stringify(state.currentTranscriptData, null, 2)], { type: 'application/json;charset=utf-8' });
        filename = 'transcript.json';
      } else if (format === 'md') {
        let md = `# Audio Transcription\n\n- Model: \`${state.model}\`\n\n## Transcript\n\n${fullText}\n\n## Dialogue\n\n`;
        sentences.forEach((s) => {
          md += `- \`[${s.begin_time_str || ''} -> ${s.end_time_str || ''}]\` ${s.speaker_label ? `**${s.speaker_label}**: ` : ''}${s.text}\n`;
        });
        blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        filename = 'transcript.md';
      }

      if (blob) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        showToast(`已生成并下载 ${filename}`);
      }
    }
  }

  // ==========================================================================
  // Settings Modal Controller (Multi-tabbed for OpenRouter, Alibaba & Common)
  // ==========================================================================

  function switchSettingsTab(tabName) {
    const tabs = {
      openrouter: { btn: el.tabBtnOpenRouter, pane: el.paneOpenRouter },
      alibaba: { btn: el.tabBtnAlibaba, pane: el.paneAlibaba },
      preferences: { btn: el.tabBtnPreferences, pane: el.panePreferences },
    };

    Object.entries(tabs).forEach(([name, item]) => {
      if (item.btn) item.btn.classList.toggle('active', name === tabName);
      if (item.pane) item.pane.classList.toggle('hidden', name !== tabName);
    });
  }

  function setActiveProvider(provider) {
    state.activeProvider = provider;
    localStorage.setItem('asr_active_provider', provider);
    syncActiveState();
    updateUIHeader();
    showToast(`当前默认服务商已切换为: ${provider === 'openrouter' ? '🌟 OpenRouter' : '☁️ 阿里云百炼'}`);
  }

  function openSettingsModal() {
    // 1. OpenRouter Pane
    if (el.settingOpenRouterApiKey) {
      el.settingOpenRouterApiKey.value = state.openrouterApiKey && state.openrouterApiKey !== 'configured_in_env' ? state.openrouterApiKey : '';
    }
    if (el.settingOpenRouterModel) {
      const orKnown = [
        'qwen/qwen3-asr-flash-2026-02-10',
        'qwen/qwen3.7-flash',
        'qwen/qwen3.7-plus',
        'qwen/qwen3.7-max',
        'qwen/qwen3.8-27b',
        'qwen/qwen3.8-max',
        'qwen/qwen3.5-flash-02-23',
        'qwen/qwen3.5-plus-02-15',
        'qwen/qwen3.5-27b',
        'qwen/qwen3-vl-32b-instruct',
        'qwen/qwen3-vl-8b-instruct',
      ];
      if (orKnown.includes(state.openrouterModel)) {
        el.settingOpenRouterModel.value = state.openrouterModel;
        if (el.settingOpenRouterCustomModel) el.settingOpenRouterCustomModel.classList.add('hidden');
      } else {
        el.settingOpenRouterModel.value = 'custom';
        if (el.settingOpenRouterCustomModel) {
          el.settingOpenRouterCustomModel.value = state.openrouterModel;
          el.settingOpenRouterCustomModel.classList.remove('hidden');
        }
      }
    }

    // 2. Alibaba DashScope Pane
    if (el.settingDashScopeApiKey) {
      el.settingDashScopeApiKey.value = state.dashscopeApiKey && state.dashscopeApiKey !== 'configured_in_env' ? state.dashscopeApiKey : '';
    }
    if (el.settingDashScopeBaseUrl) {
      el.settingDashScopeBaseUrl.value = state.dashscopeBaseUrl || '';
    }
    if (el.settingDashScopeModel) {
      const dsKnown = [
        'qwen-audio-3.0-asr-flash-filetrans',
        'qwen3-asr-flash-filetrans',
        'qwen-audio-asr',
        'sensevoice-v1',
        'paraformer-v2',
        'paraformer-8k-v2',
      ];
      if (dsKnown.includes(state.dashscopeModel)) {
        el.settingDashScopeModel.value = state.dashscopeModel;
        if (el.settingDashScopeCustomModel) el.settingDashScopeCustomModel.classList.add('hidden');
      } else {
        el.settingDashScopeModel.value = 'custom';
        if (el.settingDashScopeCustomModel) {
          el.settingDashScopeCustomModel.value = state.dashscopeModel;
          el.settingDashScopeCustomModel.classList.remove('hidden');
        }
      }
    }

    // 3. Preferences Pane
    if (el.langChipsContainer) {
      const checkboxes = el.langChipsContainer.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb) => {
        cb.checked = state.languageHints.includes(cb.value);
      });
    }
    if (el.settingDiarization) {
      el.settingDiarization.checked = state.diarization;
      if (el.speakerCountGroup) el.speakerCountGroup.classList.toggle('hidden', !state.diarization);
    }
    if (el.settingSpeakerCount) el.settingSpeakerCount.value = state.speakerCount || '';
    if (el.settingDisfluency) el.settingDisfluency.checked = state.disfluency;
    if (el.settingAlignTimestamps) el.settingAlignTimestamps.checked = state.alignTimestamps;
    if (el.settingPrompt) el.settingPrompt.value = state.prompt || '';

    // Switch to active tab by default
    switchSettingsTab(state.activeProvider === 'dashscope' ? 'alibaba' : 'openrouter');

    // Clear validation results
    if (el.openRouterKeyValidationResult) {
      el.openRouterKeyValidationResult.textContent = '支持在浏览器本地保存，或配置系统环境变量 OPENROUTER_API_KEY';
      el.openRouterKeyValidationResult.style.color = '';
    }
    if (el.dashScopeKeyValidationResult) {
      el.dashScopeKeyValidationResult.textContent = '支持在浏览器本地保存，或配置系统环境变量 DASHSCOPE_API_KEY';
      el.dashScopeKeyValidationResult.style.color = '';
    }

    updateUIHeader();
    el.settingsModal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    el.settingsModal.classList.add('hidden');
  }

  function toggleOpenRouterKeyVisibility() {
    if (el.settingOpenRouterApiKey.type === 'password') {
      el.settingOpenRouterApiKey.type = 'text';
    } else {
      el.settingOpenRouterApiKey.type = 'password';
    }
  }

  function toggleDashScopeKeyVisibility() {
    if (el.settingDashScopeApiKey.type === 'password') {
      el.settingDashScopeApiKey.type = 'text';
    } else {
      el.settingDashScopeApiKey.type = 'password';
    }
  }

  async function testOpenRouterKey() {
    const key = el.settingOpenRouterApiKey ? el.settingOpenRouterApiKey.value.trim() : '';
    if (!key) {
      if (el.openRouterKeyValidationResult) {
        el.openRouterKeyValidationResult.textContent = '⚠️ 请先输入 OpenRouter API Key';
        el.openRouterKeyValidationResult.style.color = '#f59e0b';
      }
      return;
    }

    if (el.openRouterKeyValidationResult) {
      el.openRouterKeyValidationResult.textContent = '🔄 正在测试 OpenRouter 接口连接...';
      el.openRouterKeyValidationResult.style.color = '#9ca3af';
    }

    try {
      const resp = await apiFetch('/api/verify_key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, provider: 'openrouter' }),
      });
      const data = await resp.json();
      if (data.valid) {
        el.openRouterKeyValidationResult.textContent = '✅ ' + (data.message || 'OpenRouter API Key 验证成功！');
        el.openRouterKeyValidationResult.style.color = '#10b981';
      } else {
        el.openRouterKeyValidationResult.textContent = '❌ ' + (data.message || 'OpenRouter API Key 验证失败');
        el.openRouterKeyValidationResult.style.color = '#ef4444';
      }
    } catch (e) {
      if (el.openRouterKeyValidationResult) {
        el.openRouterKeyValidationResult.textContent = '❌ 网络连接错误: ' + e.message;
        el.openRouterKeyValidationResult.style.color = '#ef4444';
      }
    }
  }

  async function testDashScopeKey() {
    const key = el.settingDashScopeApiKey ? el.settingDashScopeApiKey.value.trim() : '';
    const baseUrl = el.settingDashScopeBaseUrl ? el.settingDashScopeBaseUrl.value.trim() : '';
    if (!key) {
      if (el.dashScopeKeyValidationResult) {
        el.dashScopeKeyValidationResult.textContent = '⚠️ 请先输入 DashScope API Key';
        el.dashScopeKeyValidationResult.style.color = '#f59e0b';
      }
      return;
    }

    if (el.dashScopeKeyValidationResult) {
      el.dashScopeKeyValidationResult.textContent = '🔄 正在测试 DashScope 接口与端点连接...';
      el.dashScopeKeyValidationResult.style.color = '#9ca3af';
    }

    try {
      const resp = await apiFetch('/api/verify_key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, provider: 'dashscope', base_url: baseUrl }),
      });
      const data = await resp.json();
      if (data.valid) {
        el.dashScopeKeyValidationResult.textContent = '✅ ' + (data.message || 'DashScope 验证成功！');
        el.dashScopeKeyValidationResult.style.color = '#10b981';
      } else {
        el.dashScopeKeyValidationResult.textContent = '❌ ' + (data.message || 'DashScope 验证失败');
        el.dashScopeKeyValidationResult.style.color = '#ef4444';
      }
    } catch (e) {
      if (el.dashScopeKeyValidationResult) {
        el.dashScopeKeyValidationResult.textContent = '❌ 网络连接错误: ' + e.message;
        el.dashScopeKeyValidationResult.style.color = '#ef4444';
      }
    }
  }

  function handleOpenRouterModelChange(e) {
    if (e.target.value === 'custom') {
      if (el.settingOpenRouterCustomModel) {
        el.settingOpenRouterCustomModel.classList.remove('hidden');
        el.settingOpenRouterCustomModel.focus();
      }
    } else {
      if (el.settingOpenRouterCustomModel) el.settingOpenRouterCustomModel.classList.add('hidden');
      state.openrouterModel = e.target.value;
      setActiveProvider('openrouter');
    }
  }

  function handleDashScopeModelChange(e) {
    if (e.target.value === 'custom') {
      if (el.settingDashScopeCustomModel) {
        el.settingDashScopeCustomModel.classList.remove('hidden');
        el.settingDashScopeCustomModel.focus();
      }
    } else {
      if (el.settingDashScopeCustomModel) el.settingDashScopeCustomModel.classList.add('hidden');
      state.dashscopeModel = e.target.value;
      setActiveProvider('dashscope');
    }
  }

  async function refreshOpenRouterModels() {
    if (el.refreshOpenRouterModelsBtn) {
      el.refreshOpenRouterModelsBtn.textContent = '🔄 同步中...';
      el.refreshOpenRouterModelsBtn.disabled = true;
    }

    try {
      const resp = await apiFetch('/api/models/refresh');
      const data = await resp.json();
      if (data.models && Array.isArray(data.models) && el.settingOpenRouterModel) {
        const orModels = data.models.filter((m) => m.provider === 'openrouter' || m.id.startsWith('qwen/'));
        let html = '<optgroup label="🌟 OpenRouter 平台">';
        orModels.forEach((m) => {
          const isSelected = m.id === state.openrouterModel ? 'selected' : '';
          html += `<option value="${m.id}" ${isSelected}>${m.recommended ? '⚡ ' : ''}${m.name}</option>`;
        });
        html += '</optgroup><optgroup label="✏️ 自定义"><option value="custom">✏️ 自定义模型名称...</option></optgroup>';

        el.settingOpenRouterModel.innerHTML = html;
        showToast(`✨ 已成功从 OpenRouter 同步 ${orModels.length} 个可用模型！`);
      }
    } catch (e) {
      console.warn('Failed to refresh models:', e);
      showToast('⚠️ 刷新模型列表失败: ' + e.message);
    } finally {
      if (el.refreshOpenRouterModelsBtn) {
        el.refreshOpenRouterModelsBtn.textContent = '🔄 刷新模型';
        el.refreshOpenRouterModelsBtn.disabled = false;
      }
    }
  }

  function saveSettings() {
    // 1. OpenRouter
    if (el.settingOpenRouterApiKey) {
      state.openrouterApiKey = el.settingOpenRouterApiKey.value.trim();
      localStorage.setItem('asr_openrouter_api_key', state.openrouterApiKey);
    }
    if (el.settingOpenRouterModel) {
      let orModel = el.settingOpenRouterModel.value;
      if (orModel === 'custom' && el.settingOpenRouterCustomModel) {
        orModel = el.settingOpenRouterCustomModel.value.trim() || 'qwen/qwen3-asr-flash-2026-02-10';
      }
      state.openrouterModel = orModel;
      localStorage.setItem('asr_openrouter_model', orModel);
    }

    // 2. Alibaba DashScope
    if (el.settingDashScopeApiKey) {
      state.dashscopeApiKey = el.settingDashScopeApiKey.value.trim();
      localStorage.setItem('asr_dashscope_api_key', state.dashscopeApiKey);
    }
    if (el.settingDashScopeBaseUrl) {
      state.dashscopeBaseUrl = el.settingDashScopeBaseUrl.value.trim();
      localStorage.setItem('asr_dashscope_base_url', state.dashscopeBaseUrl);
    }
    if (el.settingDashScopeModel) {
      let dsModel = el.settingDashScopeModel.value;
      if (dsModel === 'custom' && el.settingDashScopeCustomModel) {
        dsModel = el.settingDashScopeCustomModel.value.trim() || 'qwen-audio-3.0-asr-flash-filetrans';
      }
      state.dashscopeModel = dsModel;
      localStorage.setItem('asr_dashscope_model', dsModel);
    }

    // Active Provider
    if (el.radioProviderDashScope && el.radioProviderDashScope.checked) {
      state.activeProvider = 'dashscope';
    } else {
      state.activeProvider = 'openrouter';
    }
    localStorage.setItem('asr_active_provider', state.activeProvider);

    // 3. Preferences
    if (el.langChipsContainer) {
      const checkedLangs = [];
      el.langChipsContainer.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
        checkedLangs.push(cb.value);
      });
      state.languageHints = checkedLangs;
      localStorage.setItem('asr_lang_hints', JSON.stringify(checkedLangs));
    }
    if (el.settingDiarization) {
      state.diarization = el.settingDiarization.checked;
      localStorage.setItem('asr_diarization', state.diarization ? 'true' : 'false');
    }
    if (el.settingSpeakerCount) {
      state.speakerCount = el.settingSpeakerCount.value.trim();
      localStorage.setItem('asr_speaker_count', state.speakerCount);
    }
    if (el.settingDisfluency) {
      state.disfluency = el.settingDisfluency.checked;
      localStorage.setItem('asr_disfluency', state.disfluency ? 'true' : 'false');
    }
    if (el.settingAlignTimestamps) {
      state.alignTimestamps = el.settingAlignTimestamps.checked;
      localStorage.setItem('asr_align_timestamps', state.alignTimestamps ? 'true' : 'false');
    }
    if (el.settingPrompt) {
      state.prompt = el.settingPrompt.value.trim();
      localStorage.setItem('asr_prompt', state.prompt);
    }

    syncActiveState();
    updateUIHeader();
    closeSettingsModal();
    showToast('⚙️ 设置已成功保存并应用！');
  }

  function resetSettings() {
    if (el.settingOpenRouterApiKey) el.settingOpenRouterApiKey.value = '';
    if (el.settingOpenRouterModel) el.settingOpenRouterModel.value = 'qwen/qwen3-asr-flash-2026-02-10';
    if (el.settingOpenRouterCustomModel) el.settingOpenRouterCustomModel.classList.add('hidden');

    if (el.settingDashScopeApiKey) el.settingDashScopeApiKey.value = '';
    if (el.settingDashScopeBaseUrl) el.settingDashScopeBaseUrl.value = '';
    if (el.settingDashScopeModel) el.settingDashScopeModel.value = 'qwen-audio-3.0-asr-flash-filetrans';
    if (el.settingDashScopeCustomModel) el.settingDashScopeCustomModel.classList.add('hidden');

    if (el.langChipsContainer) {
      el.langChipsContainer.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.checked = cb.value === 'zh';
      });
    }
    if (el.settingDiarization) el.settingDiarization.checked = false;
    if (el.speakerCountGroup) el.speakerCountGroup.classList.add('hidden');
    if (el.settingSpeakerCount) el.settingSpeakerCount.value = '';
    if (el.settingDisfluency) el.settingDisfluency.checked = true;
    if (el.settingAlignTimestamps) el.settingAlignTimestamps.checked = true;
    if (el.settingPrompt) el.settingPrompt.value = '';
  }

  // ==========================================================================
  // History Drawer Controller
  // ==========================================================================

  async function openHistoryDrawer() {
    el.historyDrawer.classList.remove('hidden');
    el.historyList.innerHTML = '<div class="text-muted text-sm p-4 text-center">正在加载历史记录...</div>';
    loadHistoryList();
  }

  async function loadHistoryList() {
    try {
      const resp = await apiFetch('/api/history');
      const data = await resp.json();
      const items = data.history || [];

      if (el.historyCountBadge) {
        el.historyCountBadge.textContent = `${items.length} 条记录`;
        el.historyCountBadge.classList.remove('hidden');
      }

      if (el.clearAllHistoryBtn) {
        el.clearAllHistoryBtn.classList.toggle('hidden', items.length === 0);
      }

      if (items.length === 0) {
        el.historyList.innerHTML = '<div class="text-muted text-sm p-4 text-center">暂无转写历史</div>';
        return;
      }

      el.historyList.innerHTML = '';
      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.dataset.sessionId = item.session_id;
        const dateStr = item.created_at ? new Date(item.created_at * 1000).toLocaleString() : '';

        card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-title" title="${escapeHtml(item.filename || 'Audio Recording')}">${escapeHtml(item.filename || 'Audio Recording')}</span>
            <div class="history-card-actions">
              <span class="badge ${item.status === 'SUCCEEDED' ? 'badge-sm' : 'badge-gradient'}">${item.status || ''}</span>
              <button class="btn-delete-history" title="删除此记录" aria-label="删除此记录">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="history-card-meta">
            <span>🕒 ${dateStr}</span>
            <span>⏱️ ${item.duration_str || '-'}</span>
          </div>
          <div class="history-preview-text">${escapeHtml(item.preview_text || '点击加载完整转写...')}</div>
        `;

        // Card click to load
        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-delete-history')) return;
          loadHistoryItem(item.session_id);
          closeHistoryDrawer();
        });

        // Delete button click
        const deleteBtn = card.querySelector('.btn-delete-history');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteHistoryItem(item.session_id, item.filename || '录音记录', card);
          });
        }

        el.historyList.appendChild(card);
      });
    } catch (e) {
      el.historyList.innerHTML = '<div class="text-muted text-sm p-4 text-center">加载历史失败</div>';
    }
  }

  function closeHistoryDrawer() {
    el.historyDrawer.classList.add('hidden');
  }

  async function deleteHistoryItem(sessionId, filename, cardElement) {
    if (!sessionId) return;
    try {
      if (cardElement) {
        cardElement.classList.add('history-card-deleting');
      }

      const resp = await apiFetch(`/api/history/${sessionId}`, {
        method: 'DELETE',
      });

      if (!resp.ok) {
        if (cardElement) cardElement.classList.remove('history-card-deleting');
        throw new Error('删除请求失败');
      }

      setTimeout(() => {
        if (cardElement && cardElement.parentNode) {
          cardElement.remove();
        }
        loadHistoryList();
      }, 200);

      showToast(`已删除历史记录: ${filename}`);

      // If active session was deleted, clear active session ID
      if (state.currentSessionId === sessionId) {
        state.currentSessionId = null;
      }
    } catch (err) {
      showError(`删除历史记录失败: ${err.message}`);
    }
  }

  async function clearAllHistory() {
    if (!confirm('确定要清空全部转写历史记录吗？此操作将不可恢复。')) {
      return;
    }

    try {
      const resp = await apiFetch('/api/history/clear', {
        method: 'DELETE',
      });

      if (!resp.ok) {
        throw new Error('清空请求失败');
      }

      const data = await resp.json();
      loadHistoryList();
      showToast(data.message || '已清空所有历史记录');

      // Clear current session pointer
      state.currentSessionId = null;
    } catch (err) {
      showError(`清空历史记录失败: ${err.message}`);
    }
  }

  async function loadHistoryItem(sessionId) {
    try {
      const resp = await apiFetch(`/api/history/${sessionId}`);
      if (!resp.ok) throw new Error('Failed to load session');
      const session = await resp.json();
      state.currentSessionId = session.session_id;
      state.currentTaskId = session.task_id;
      if (session.audio_url) {
        const audioUrl = state.authPasscode ? `${session.audio_url}?token=${encodeURIComponent(state.authPasscode)}` : session.audio_url;
        el.globalSyncAudio.src = audioUrl;
      }
      renderTranscriptionResults(session);
      showToast(`已加载历史会话: ${session.filename || sessionId}`);
    } catch (e) {
      showError('无法加载该历史会话数据');
    }
  }

  // ==========================================================================
  // Helper Utilities
  // ==========================================================================

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Run initial setup when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
