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

    apiKey: localStorage.getItem('asr_api_key') || localStorage.getItem('dashscope_api_key') || '',
    model: localStorage.getItem('asr_model') || localStorage.getItem('dashscope_model') || 'qwen/qwen3-asr-flash-2026-02-10',
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

  // DOM Elements
  const el = {
    // Header & Auth
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    setupBtnLabel: document.getElementById('setupBtnLabel'),
    setupStatusDot: document.getElementById('setupStatusDot'),
    toggleHistoryBtn: document.getElementById('toggleHistoryBtn'),
    lockAppBtn: document.getElementById('lockAppBtn'),

    // Login Passcode Modal
    loginModal: document.getElementById('loginModal'),
    loginForm: document.getElementById('loginForm'),
    loginPasscodeInput: document.getElementById('loginPasscodeInput'),
    toggleLoginPasscodeVisibility: document.getElementById('toggleLoginPasscodeVisibility'),
    submitLoginBtn: document.getElementById('submitLoginBtn'),
    loginErrorMsg: document.getElementById('loginErrorMsg'),

    // Tabs
    tabRecordBtn: document.getElementById('tabRecordBtn'),
    tabUploadBtn: document.getElementById('tabUploadBtn'),
    recordPanel: document.getElementById('recordPanel'),
    uploadPanel: document.getElementById('uploadPanel'),

    // Recorder
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

    // Upload
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

    // Results
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

    // Settings Modal
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    settingApiKey: document.getElementById('settingApiKey'),
    toggleKeyVisibilityBtn: document.getElementById('toggleKeyVisibilityBtn'),
    testKeyBtn: document.getElementById('testKeyBtn'),
    keyValidationResult: document.getElementById('keyValidationResult'),
    settingModelSelect: document.getElementById('settingModelSelect'),
    refreshModelsBtn: document.getElementById('refreshModelsBtn'),
    settingCustomModel: document.getElementById('settingCustomModel'),
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
        if (config.has_env_api_key && !state.apiKey) {
          state.apiKey = config.masked_openrouter_key || config.masked_dashscope_key || 'configured_in_env';
          updateUIHeader();
        }
      }
    } catch (e) {
      console.warn('Could not fetch server config:', e);
    }
  }

  function updateUIHeader() {
    const hasKey = Boolean(state.apiKey && state.apiKey.length > 3);
    const shortModel = state.model.split('/').pop().replace('-filetrans', '');
    if (el.setupBtnLabel) {
      el.setupBtnLabel.textContent = `设置 (${shortModel})`;
    }
    if (el.setupStatusDot) {
      el.setupStatusDot.classList.toggle('active', hasKey);
      el.setupStatusDot.title = hasKey ? 'API Key 已配置' : 'API Key 未配置，点击设置';
    }
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
    el.tabRecordBtn.addEventListener('click', () => switchTab('record'));
    el.tabUploadBtn.addEventListener('click', () => switchTab('upload'));

    // Recorder Controls
    el.startRecordBtn.addEventListener('click', startRecording);
    el.pauseRecordBtn.addEventListener('click', togglePauseRecording);
    el.stopRecordBtn.addEventListener('click', stopRecording);
    el.cancelRecordBtn.addEventListener('click', cancelRecording);
    el.reRecordBtn.addEventListener('click', cancelRecording);
    el.transcribeRecordedBtn.addEventListener('click', () => submitTranscription('record'));

    // File Upload
    el.dropZone.addEventListener('dragover', handleDragOver);
    el.dropZone.addEventListener('dragleave', handleDragLeave);
    el.dropZone.addEventListener('drop', handleFileDrop);
    el.fileInput.addEventListener('change', handleFileSelect);
    el.removeFileBtn.addEventListener('click', clearUploadedFile);
    el.transcribeUploadedBtn.addEventListener('click', () => submitTranscription('upload'));

    // Error Close
    el.closeErrorBtn.addEventListener('click', hideError);

    // Synchronized Player Controls
    el.playerPlayBtn.addEventListener('click', togglePlayAudio);
    el.playerScrubber.addEventListener('input', handleScrubberSeek);
    el.playbackSpeedSelect.addEventListener('change', (e) => {
      el.globalSyncAudio.playbackRate = parseFloat(e.target.value);
    });
    el.globalSyncAudio.addEventListener('timeupdate', handleAudioTimeUpdate);
    el.globalSyncAudio.addEventListener('ended', handleAudioEnded);
    el.globalSyncAudio.addEventListener('play', () => {
      el.playerPlayIcon.classList.add('hidden');
      el.playerPauseIcon.classList.remove('hidden');
    });
    el.globalSyncAudio.addEventListener('pause', () => {
      el.playerPlayIcon.classList.remove('hidden');
      el.playerPauseIcon.classList.add('hidden');
    });

    // Transcript Views Switcher
    el.viewDialogueBtn.addEventListener('click', () => switchTranscriptView('dialogue'));
    el.viewDocumentBtn.addEventListener('click', () => switchTranscriptView('document'));
    el.viewSrtBtn.addEventListener('click', () => switchTranscriptView('srt'));
    el.viewJsonBtn.addEventListener('click', () => switchTranscriptView('json'));

    // Search
    el.transcriptSearchInput.addEventListener('input', handleSearch);

    // Export Dropdown
    el.exportDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.exportMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      el.exportMenu.classList.add('hidden');
    });
    el.exportMenu.querySelectorAll('[data-export]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-export');
        exportTranscript(fmt);
      });
    });
    el.copyAllTextBtn.addEventListener('click', copyFullText);

    // Settings Modal
    el.openSettingsBtn.addEventListener('click', openSettingsModal);
    el.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target === el.settingsModal) closeSettingsModal();
    });
    el.toggleKeyVisibilityBtn.addEventListener('click', toggleKeyVisibility);
    el.testKeyBtn.addEventListener('click', testApiKey);
    if (el.refreshModelsBtn) {
      el.refreshModelsBtn.addEventListener('click', refreshOpenRouterModels);
    }
    el.settingModelSelect.addEventListener('change', handleModelSelectChange);
    el.settingDiarization.addEventListener('change', (e) => {
      el.speakerCountGroup.classList.toggle('hidden', !e.target.checked);
    });
    el.saveSettingsBtn.addEventListener('click', saveSettings);
    el.resetSettingsBtn.addEventListener('click', resetSettings);

    // History Drawer
    el.toggleHistoryBtn.addEventListener('click', openHistoryDrawer);
    el.closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
    el.historyDrawer.addEventListener('click', (e) => {
      if (e.target === el.historyDrawer) closeHistoryDrawer();
    });
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
  // Settings Modal Controller
  // ==========================================================================

  function openSettingsModal() {
    el.settingApiKey.value = state.apiKey && state.apiKey !== 'configured_in_env' ? state.apiKey : '';

    // Model Select
    const knownModels = [
      'qwen/qwen3-asr-flash-2026-02-10',
      'qwen-audio-3.0-asr-flash-filetrans',
      'qwen3-asr-flash-filetrans',
      'qwen-audio-asr',
      'sensevoice-v1',
      'paraformer-v2',
      'paraformer-8k-v2',
    ];
    if (knownModels.includes(state.model)) {
      el.settingModelSelect.value = state.model;
      el.settingCustomModel.classList.add('hidden');
    } else {
      el.settingModelSelect.value = 'custom';
      el.settingCustomModel.value = state.model;
      el.settingCustomModel.classList.remove('hidden');
    }

    // Language Chips
    const checkboxes = el.langChipsContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => {
      cb.checked = state.languageHints.includes(cb.value);
    });

    // Toggles
    el.settingDiarization.checked = state.diarization;
    el.speakerCountGroup.classList.toggle('hidden', !state.diarization);
    el.settingSpeakerCount.value = state.speakerCount || '';
    el.settingDisfluency.checked = state.disfluency;
    el.settingAlignTimestamps.checked = state.alignTimestamps;
    el.settingPrompt.value = state.prompt || '';

    el.keyValidationResult.textContent = '支持在浏览器本地保存，或配置系统环境变量 OPENROUTER_API_KEY / DASHSCOPE_API_KEY';
    el.keyValidationResult.style.color = '';

    el.settingsModal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    el.settingsModal.classList.add('hidden');
  }

  function toggleKeyVisibility() {
    if (el.settingApiKey.type === 'password') {
      el.settingApiKey.type = 'text';
    } else {
      el.settingApiKey.type = 'password';
    }
  }

  async function testApiKey() {
    const key = el.settingApiKey.value.trim();
    if (!key) {
      el.keyValidationResult.textContent = '⚠️ 请先输入 API Key';
      el.keyValidationResult.style.color = '#f59e0b';
      return;
    }

    const isOr = key.startsWith('sk-or-');
    el.keyValidationResult.textContent = `🔄 正在测试 ${isOr ? 'OpenRouter' : 'DashScope'} 接口连接...`;
    el.keyValidationResult.style.color = '#9ca3af';

    try {
      const resp = await apiFetch('/api/verify_key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key }),
      });
      const data = await resp.json();
      if (data.valid) {
        el.keyValidationResult.textContent = '✅ ' + (data.message || 'API Key 验证成功！');
        el.keyValidationResult.style.color = '#10b981';
      } else {
        el.keyValidationResult.textContent = '❌ ' + (data.message || 'API Key 验证失败');
        el.keyValidationResult.style.color = '#ef4444';
      }
    } catch (e) {
      el.keyValidationResult.textContent = '❌ 网络连接错误: ' + e.message;
      el.keyValidationResult.style.color = '#ef4444';
    }
  }

  async function refreshOpenRouterModels() {
    if (el.refreshModelsBtn) {
      el.refreshModelsBtn.textContent = '🔄 同步中...';
      el.refreshModelsBtn.disabled = true;
    }

    try {
      const resp = await apiFetch('/api/models/refresh');
      const data = await resp.json();
      if (data.models && Array.isArray(data.models)) {
        // Group models by category
        const groups = {};
        data.models.forEach((m) => {
          const cat = m.category || (m.provider === 'openrouter' ? '🌟 OpenRouter 平台' : '☁️ 阿里云百炼平台');
          if (!groups[cat]) groups[cat] = [];
          groups[cat].push(m);
        });

        // Rebuild select HTML
        let html = '';
        for (const [catName, models] of Object.entries(groups)) {
          html += `<optgroup label="${catName}">`;
          models.forEach((m) => {
            const isSelected = m.id === state.model ? 'selected' : '';
            html += `<option value="${m.id}" ${isSelected}>${m.recommended ? '⚡ ' : ''}${m.name}</option>`;
          });
          html += '</optgroup>';
        }
        html += '<optgroup label="✏️ 自定义"><option value="custom">✏️ 自定义模型名称...</option></optgroup>';

        el.settingModelSelect.innerHTML = html;
        showToast(`✨ 已成功从 OpenRouter 同步 ${data.count || data.models.length} 个可用模型！`);
      }
    } catch (e) {
      console.warn('Failed to refresh models:', e);
      showToast('⚠️ 刷新模型列表失败: ' + e.message);
    } finally {
      if (el.refreshModelsBtn) {
        el.refreshModelsBtn.textContent = '🔄 刷新模型';
        el.refreshModelsBtn.disabled = false;
      }
    }
  }

  function handleModelSelectChange(e) {
    if (e.target.value === 'custom') {
      el.settingCustomModel.classList.remove('hidden');
      el.settingCustomModel.focus();
    } else {
      el.settingCustomModel.classList.add('hidden');
    }
  }

  function saveSettings() {
    // API Key
    const keyVal = el.settingApiKey.value.trim();
    state.apiKey = keyVal;
    localStorage.setItem('asr_api_key', keyVal);
    localStorage.setItem('dashscope_api_key', keyVal);

    // Model
    let selectedModel = el.settingModelSelect.value;
    if (selectedModel === 'custom') {
      selectedModel = el.settingCustomModel.value.trim() || 'qwen/qwen3-asr-flash-2026-02-10';
    }
    state.model = selectedModel;
    localStorage.setItem('asr_model', selectedModel);
    localStorage.setItem('dashscope_model', selectedModel);

    // Languages
    const checkedLangs = [];
    el.langChipsContainer.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
      checkedLangs.push(cb.value);
    });
    state.languageHints = checkedLangs;
    localStorage.setItem('asr_lang_hints', JSON.stringify(checkedLangs));
    localStorage.setItem('dashscope_lang_hints', JSON.stringify(checkedLangs));

    // Diarization
    state.diarization = el.settingDiarization.checked;
    localStorage.setItem('asr_diarization', state.diarization ? 'true' : 'false');
    state.speakerCount = el.settingSpeakerCount.value.trim();
    localStorage.setItem('asr_speaker_count', state.speakerCount);

    // Other options
    state.disfluency = el.settingDisfluency.checked;
    localStorage.setItem('asr_disfluency', state.disfluency ? 'true' : 'false');

    state.alignTimestamps = el.settingAlignTimestamps.checked;
    localStorage.setItem('asr_align_timestamps', state.alignTimestamps ? 'true' : 'false');

    state.prompt = el.settingPrompt.value.trim();
    localStorage.setItem('asr_prompt', state.prompt);

    updateUIHeader();
    closeSettingsModal();
    showToast('⚙️ 设置已成功保存！');
  }

  function resetSettings() {
    el.settingApiKey.value = '';
    el.settingModelSelect.value = 'qwen/qwen3-asr-flash-2026-02-10';
    el.settingCustomModel.classList.add('hidden');
    el.langChipsContainer.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = cb.value === 'zh';
    });
    el.settingDiarization.checked = false;
    el.speakerCountGroup.classList.add('hidden');
    el.settingSpeakerCount.value = '';
    el.settingDisfluency.checked = true;
    el.settingAlignTimestamps.checked = true;
    el.settingPrompt.value = '';
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

      if (items.length === 0) {
        el.historyList.innerHTML = '<div class="text-muted text-sm p-4 text-center">暂无转写历史</div>';
        return;
      }

      el.historyList.innerHTML = '';
      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'history-card';
        const dateStr = item.created_at ? new Date(item.created_at * 1000).toLocaleString() : '';

        card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-title">${escapeHtml(item.filename || 'Audio Recording')}</span>
            <span class="badge ${item.status === 'SUCCEEDED' ? 'badge-sm' : 'badge-gradient'}">${item.status || ''}</span>
          </div>
          <div class="history-card-meta">
            <span>🕒 ${dateStr}</span>
            <span>⏱️ ${item.duration_str || '-'}</span>
          </div>
          <div class="history-preview-text">${escapeHtml(item.preview_text || '点击加载完整转写...')}</div>
        `;

        card.addEventListener('click', () => {
          loadHistoryItem(item.session_id);
          closeHistoryDrawer();
        });

        el.historyList.appendChild(card);
      });
    } catch (e) {
      el.historyList.innerHTML = '<div class="text-muted text-sm p-4 text-center">加载历史失败</div>';
    }
  }

  function closeHistoryDrawer() {
    el.historyDrawer.classList.add('hidden');
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
