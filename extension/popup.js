// Bookmarks Manager Extension
(function() {
  'use strict';

  // DOM Elements
  const titleInput = document.getElementById('title');
  const urlInput = document.getElementById('url');
  const categorySelect = document.getElementById('category');
  const saveBtn = document.getElementById('save-btn');
  const openManagerBtn = document.getElementById('open-manager-btn');
  const checkBtn = document.getElementById('check-btn');
  const statusDiv = document.getElementById('status');
  const connectionDot = document.getElementById('connection-dot');
  const connectionText = document.getElementById('connection-text');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsContent = document.getElementById('settings-content');
  const serverUrlInput = document.getElementById('server-url');
  const apiTokenInput = document.getElementById('api-token');
  const toggleTokenBtn = document.getElementById('toggle-token-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const openSettingsLink = document.getElementById('open-settings-link');

  // State
  let categories = [];
  let isConnected = false;

  // Initialize
  async function init() {
    await loadSettings();
    await getCurrentTab();
    await checkConnection();
    setupEventListeners();
  }

  // Load settings from storage
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['serverUrl', 'apiToken'], (result) => {
        if (result.serverUrl) {
          serverUrlInput.value = result.serverUrl;
        } else {
          serverUrlInput.value = 'http://localhost:8080';
        }
        if (result.apiToken) {
          apiTokenInput.value = result.apiToken;
        }
        resolve();
      });
    });
  }

  // Save settings to storage
  async function saveSettings() {
    const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
    const apiToken = apiTokenInput.value.trim();

    return new Promise((resolve) => {
      chrome.storage.sync.set({ serverUrl, apiToken }, () => {
        resolve();
      });
    });
  }

  // Get current tab info
  async function getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        titleInput.value = tab.title || '';
        urlInput.value = tab.url || '';
      }
    } catch (e) {
      console.error('Failed to get current tab:', e);
    }
  }

  // Get server URL
  function getServerUrl() {
    return serverUrlInput.value.trim().replace(/\/$/, '') || 'http://localhost:8080';
  }

  // Get headers for API requests
  function getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    const apiToken = apiTokenInput.value.trim();
    if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`;
    }
    return headers;
  }

  // Check connection to server
  async function checkConnection() {
    const serverUrl = getServerUrl();
    const hasToken = apiTokenInput.value.trim().length > 0;
    
    try {
      updateConnectionStatus('checking');
      
      const response = await fetch(`${serverUrl}/api/categories`, {
        method: 'GET',
        headers: getHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        categories = data.categories || data || [];
        updateCategorySelect();
        updateConnectionStatus('connected');
        isConnected = true;
        return true;
      } else if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        if (data.error === 'API token has expired') {
          updateConnectionStatus('token_expired');
        } else if (data.error === 'Invalid API token') {
          updateConnectionStatus('token_invalid');
        } else {
          updateConnectionStatus('auth_required');
        }
        isConnected = false;
        return false;
      } else if (response.status === 403) {
        updateConnectionStatus('forbidden');
        isConnected = false;
        return false;
      } else {
        updateConnectionStatus('error');
        isConnected = false;
        return false;
      }
    } catch (e) {
      console.error('Connection check failed:', e);
      // 检查是否是 CORS 或网络错误
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        updateConnectionStatus('network_error');
      } else {
        updateConnectionStatus('error');
      }
      isConnected = false;
      return false;
    }
  }

  // Update connection status UI
  function updateConnectionStatus(status) {
    connectionDot.className = 'connection-dot';
    
    switch (status) {
      case 'connected':
        connectionDot.classList.add('connected');
        connectionText.textContent = '已连接';
        break;
      case 'checking':
        connectionText.textContent = '检查中...';
        break;
      case 'auth_required':
        connectionDot.classList.add('disconnected');
        connectionText.textContent = '需要配置 Token';
        break;
      case 'token_expired':
        connectionDot.classList.add('warning');
        connectionText.textContent = 'Token 已过期';
        break;
      case 'token_invalid':
        connectionDot.classList.add('disconnected');
        connectionText.textContent = 'Token 无效';
        break;
      case 'forbidden':
        connectionDot.classList.add('disconnected');
        connectionText.textContent = '访问被拒绝';
        break;
      case 'network_error':
        connectionDot.classList.add('disconnected');
        connectionText.textContent = '网络错误';
        break;
      case 'error':
        connectionDot.classList.add('disconnected');
        connectionText.textContent = '连接失败';
        break;
      default:
        connectionText.textContent = '未连接';
    }
  }

  // Update category select options
  function updateCategorySelect() {
    categorySelect.innerHTML = '<option value="">未分类</option>';
    
    categories.forEach((cat) => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      categorySelect.appendChild(option);
    });
  }

  // Show status message
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
  }

  // Hide status message
  function hideStatus() {
    statusDiv.className = 'status';
  }

  // Save bookmark
  async function saveBookmark() {
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    const categoryId = categorySelect.value;

    if (!url) {
      showStatus('请输入网址', 'error');
      return;
    }

    if (!isConnected) {
      showStatus('请先连接到服务器', 'error');
      return;
    }

    const serverUrl = getServerUrl();

    try {
      saveBtn.disabled = true;
      showStatus('保存中...', 'loading');

      const body = {
        url: url,
        title: title || url,
      };

      if (categoryId) {
        body.category_id = parseInt(categoryId, 10);
      }

      const response = await fetch(`${serverUrl}/api/bookmarks`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.skipped) {
          showStatus('书签已存在', 'warning');
        } else {
          showStatus('书签已保存！', 'success');
          // Auto close after success
          setTimeout(() => {
            window.close();
          }, 1500);
        }
      } else if (response.status === 401) {
        if (data.error === 'API token has expired') {
          showStatus('Token 已过期，请重新生成', 'error');
          updateConnectionStatus('token_expired');
        } else {
          showStatus('认证失败，请检查 Token', 'error');
          updateConnectionStatus('token_invalid');
        }
        isConnected = false;
      } else {
        showStatus(data.error || '保存失败', 'error');
      }
    } catch (e) {
      console.error('Save bookmark failed:', e);
      showStatus('保存失败：网络错误', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  // Open manager in new tab
  function openManager() {
    const serverUrl = getServerUrl();
    chrome.tabs.create({ url: serverUrl });
  }

  // Open settings page
  function openSettingsPage() {
    const serverUrl = getServerUrl();
    chrome.tabs.create({ url: `${serverUrl}/settings` });
  }

  // Toggle token visibility
  function toggleTokenVisibility() {
    if (apiTokenInput.type === 'password') {
      apiTokenInput.type = 'text';
      toggleTokenBtn.textContent = '隐藏';
    } else {
      apiTokenInput.type = 'password';
      toggleTokenBtn.textContent = '显示';
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    // Save bookmark
    saveBtn.addEventListener('click', saveBookmark);

    // Open manager
    openManagerBtn.addEventListener('click', openManager);

    // Check connection
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      await checkConnection();
      checkBtn.disabled = false;
    });

    // Toggle settings
    settingsToggle.addEventListener('click', () => {
      settingsToggle.classList.toggle('open');
      settingsContent.classList.toggle('show');
    });

    // Toggle token visibility
    toggleTokenBtn.addEventListener('click', toggleTokenVisibility);

    // Open settings page link
    openSettingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      openSettingsPage();
    });

    // Save settings
    saveSettingsBtn.addEventListener('click', async () => {
      await saveSettings();
      showStatus('设置已保存', 'success');
      await checkConnection();
      setTimeout(hideStatus, 2000);
    });

    // Enter key to save
    titleInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveBookmark();
      }
    });

    // Auto-save settings on blur
    serverUrlInput.addEventListener('blur', saveSettings);
    apiTokenInput.addEventListener('blur', saveSettings);
  }

  // Start
  init();
})();
