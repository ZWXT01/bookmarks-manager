// Bookmarks Manager Extension - API Token Only
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
    
    // 检查是否配置了 Token
    const apiToken = apiTokenInput.value.trim();
    if (!apiToken) {
      updateConnectionStatus('no_token');
      // 自动展开设置
      settingsToggle.classList.add('open');
      settingsContent.classList.add('show');
    } else {
      await checkConnection();
    }
    
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

  // Get headers for API requests (Token required)
  function getHeaders() {
    const apiToken = apiTokenInput.value.trim();
    if (!apiToken) {
      throw new Error('API Token 未配置');
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
    };
  }

  // Check connection to server using API Token
  async function checkConnection() {
    const serverUrl = getServerUrl();
    const apiToken = apiTokenInput.value.trim();
    
    // 必须配置 Token
    if (!apiToken) {
      updateConnectionStatus('no_token');
      isConnected = false;
      return false;
    }
    
    try {
      updateConnectionStatus('checking');
      
      const response = await fetch(`${serverUrl}/api/categories`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
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
          updateConnectionStatus('token_invalid');
        }
        isConnected = false;
        return false;
      } else if (response.status === 403) {
        updateConnectionStatus('forbidden');
        isConnected = false;
        return false;
      } else {
        updateConnectionStatus('server_error', response.status);
        isConnected = false;
        return false;
      }
    } catch (e) {
      console.error('Connection check failed:', e);
      updateConnectionStatus('network_error');
      isConnected = false;
      return false;
    }
  }

  // Update connection status UI
  function updateConnectionStatus(status, code) {
    connectionDot.className = 'connection-dot';
    
    switch (status) {
      case 'connected':
        connectionDot.classList.add('connected');
        connectionText.textContent = '已连接';
        break;
      case 'checking':
        connectionText.textContent = '检查中...';
        break;
      case 'no_token':
        connectionDot.classList.add('warning');
        connectionText.textContent = '请配置 API Token';
        break;
      case 'token_expired':
        connectionDot.classList.add('warning');
        connectionText.textContent = 'Token 已过期，请重新生成';
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
        connectionText.textContent = '网络错误，请检查服务器地址';
        break;
      case 'server_error':
        connectionDot.classList.add('disconnected');
        connectionText.textContent = `服务器错误 (${code || ''})`;
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
    const apiToken = apiTokenInput.value.trim();

    if (!apiToken) {
      showStatus('请先配置 API Token', 'error');
      return;
    }

    if (!url) {
      showStatus('请输入网址', 'error');
      return;
    }

    if (!isConnected) {
      showStatus('未连接到服务器，请检查设置', 'error');
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.skipped) {
          showStatus('书签已存在', 'warning');
        } else {
          showStatus('书签已保存！', 'success');
          setTimeout(() => {
            window.close();
          }, 1500);
        }
      } else if (response.status === 401) {
        if (data.error === 'API token has expired') {
          showStatus('Token 已过期，请重新生成', 'error');
          updateConnectionStatus('token_expired');
        } else {
          showStatus('Token 无效，请检查配置', 'error');
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
