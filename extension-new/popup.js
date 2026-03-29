// Bookmarks Manager Extension with Optimistic UI
(function () {
    'use strict';

    // DOM Elements
    const titleInput = document.getElementById('title');
    const urlInput = document.getElementById('url');
    const categorySelect = document.getElementById('category');
    const saveBtn = document.getElementById('save-btn');
    const snapshotBtn = document.getElementById('snapshot-btn');
    const saveAllBtn = document.getElementById('save-all-btn');
    const openManagerBtn = document.getElementById('open-manager-btn');
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
    let lastConnectedAt = 0;

    // Initialize
    async function init() {
        await loadSettings();
        await getCurrentTab();

        const apiToken = apiTokenInput.value.trim();
        if (!apiToken) {
            updateConnectionStatus('no_token');
            settingsToggle.classList.add('open');
            settingsContent.classList.remove('hidden');
        } else {
            // 乐观 UI：如果 5 分钟内连接过，先显示已连接
            await loadConnectionCache();
            if (lastConnectedAt > Date.now() - 5 * 60 * 1000) {
                updateConnectionStatus('connected');
                // 后台静默验证
                silentCheckConnection();
            } else {
                await checkConnection();
            }
        }

        setupEventListeners();
    }

    // Load settings from storage
    async function loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['serverUrl', 'apiToken'], (result) => {
                serverUrlInput.value = result.serverUrl || 'http://localhost:8080';
                apiTokenInput.value = result.apiToken || '';
                resolve();
            });
        });
    }

    // Load connection cache
    async function loadConnectionCache() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['lastConnectedAt', 'cachedCategories'], (result) => {
                lastConnectedAt = result.lastConnectedAt || 0;
                if (result.cachedCategories) {
                    categories = result.cachedCategories;
                    updateCategorySelect();
                }
                resolve();
            });
        });
    }

    // Save connection cache
    async function saveConnectionCache() {
        lastConnectedAt = Date.now();
        return new Promise((resolve) => {
            chrome.storage.local.set({
                lastConnectedAt,
                cachedCategories: categories
            }, resolve);
        });
    }

    // Save settings
    async function saveSettings() {
        const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
        const apiToken = apiTokenInput.value.trim();

        return new Promise((resolve) => {
            chrome.storage.sync.set({ serverUrl, apiToken }, resolve);
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
            // Ignore errors
        }
    }

    // Get server URL
    function getServerUrl() {
        return serverUrlInput.value.trim().replace(/\/$/, '') || 'http://localhost:8080';
    }

    // Get headers for API requests
    function getHeaders() {
        const apiToken = apiTokenInput.value.trim();
        if (!apiToken) throw new Error('API Token 未配置');
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`,
        };
    }

    // Update connection status
    function updateConnectionStatus(status) {
        connectionDot.className = 'dot';
        if (status === 'connected') {
            connectionDot.classList.add('connected');
            connectionText.textContent = '已连接';
            isConnected = true;
        } else if (status === 'loading') {
            connectionDot.classList.add('loading');
            connectionText.textContent = '连接中...';
        } else if (status === 'no_token') {
            connectionDot.classList.add('disconnected');
            connectionText.textContent = '请配置 Token';
            isConnected = false;
        } else {
            connectionDot.classList.add('disconnected');
            connectionText.textContent = '未连接';
            isConnected = false;
        }
    }

    // Check connection (with timeout)
    async function checkConnection() {
        updateConnectionStatus('loading');
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(`${getServerUrl()}/api/categories`, {
                headers: getHeaders(),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (res.ok) {
                const data = await res.json();
                categories = data.categories || [];
                updateCategorySelect();
                updateConnectionStatus('connected');
                await saveConnectionCache();
            } else {
                updateConnectionStatus('disconnected');
            }
        } catch (e) {
            updateConnectionStatus('disconnected');
        }
    }

    // Silent check connection (no UI update during check)
    async function silentCheckConnection() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(`${getServerUrl()}/api/categories`, {
                headers: getHeaders(),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (res.ok) {
                const data = await res.json();
                categories = data.categories || [];
                updateCategorySelect();
                await saveConnectionCache();
            } else {
                // Token 失效，更新状态
                updateConnectionStatus('disconnected');
            }
        } catch (e) {
            // 网络错误，保持当前状态
        }
    }

    // Update category select
    function getSelectedCategoryId() {
        const raw = categorySelect.value;
        if (!raw) return null;

        const parsed = Number(raw);
        if (Number.isInteger(parsed)) return parsed;

        const matched = categories.find((cat) => String(cat.id) === raw || cat.fullPath === raw || cat.name === raw);
        return matched ? matched.id : null;
    }

    function updateCategorySelect() {
        categorySelect.innerHTML = '<option value="">-- 选择分类 --</option>';
        categories.forEach((cat) => {
            const option = document.createElement('option');
            option.value = String(cat.id);
            option.textContent = cat.fullPath || cat.name;
            categorySelect.appendChild(option);
        });
    }

    // Show status message
    function showStatus(message, type = 'loading') {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
    }

    function hideStatus() {
        statusDiv.className = 'status hidden';
    }

    // Save bookmark
    async function saveBookmark() {
        const url = urlInput.value.trim();
        const title = titleInput.value.trim();
        const categoryId = getSelectedCategoryId();

        if (!url) {
            showStatus('请输入网址', 'error');
            return false;
        }

        if (!isConnected) {
            showStatus('未连接到服务器', 'error');
            return false;
        }

        showStatus('保存书签中...', 'loading');

        try {
            const res = await fetch(`${getServerUrl()}/api/bookmarks`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ url, title, category_id: categoryId }),
            });

            const data = await res.json();
            if (res.ok) {
                showStatus('✅ 书签保存成功!', 'success');
                setTimeout(hideStatus, 2000);
                return true;
            } else {
                showStatus(data.error || '保存失败', 'error');
                return false;
            }
        } catch (e) {
            showStatus('保存失败: ' + e.message, 'error');
            return false;
        }
    }

    // Save snapshot using SingleFile via content script
    async function saveSnapshot() {
        const url = urlInput.value.trim();
        const title = titleInput.value.trim();

        if (!url) {
            showStatus('请输入网址', 'error');
            return false;
        }

        if (!isConnected) {
            showStatus('未连接到服务器', 'error');
            return false;
        }

        snapshotBtn.disabled = true;
        saveAllBtn.disabled = true;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) {
                throw new Error('无法获取当前标签页');
            }

            // 注入 SingleFile 和 content.js
            showStatus('正在准备...', 'loading');
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['lib/single-file.js', 'content.js']
                });
            } catch (e) {
                // Ignore injection warnings
            }

            showStatus('正在处理网页...', 'loading');

            // 使用消息传递调用 content.js
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('处理超时，请刷新页面后重试'));
                }, 180000);

                chrome.tabs.sendMessage(tab.id, { method: 'getPageData', options: {} }, (response) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message || '无法连接到页面'));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (!response || !response.success || !response.data || !response.data.content) {
                throw new Error(response?.error || '获取页面数据失败');
            }

            const pageData = response.data;
            const sizeMB = (pageData.content.length / 1024 / 1024).toFixed(2);
            const elapsed = pageData.elapsed ? ` (${(pageData.elapsed / 1000).toFixed(1)}s)` : '';

            showStatus(`正在上传 (${sizeMB} MB)...`, 'loading');

            const res = await fetch(`${getServerUrl()}/api/snapshots`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({
                    url: url,
                    title: title || pageData.title || 'untitled',
                    content: pageData.content,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                const method = pageData.method === 'singlefile' ? 'SingleFile' : '原生';
                showStatus(`✅ 快照已保存 (${method}${elapsed})`, 'success');
                setTimeout(hideStatus, 3000);
                return true;
            } else {
                showStatus(data.error || '保存失败', 'error');
                return false;
            }
        } catch (e) {
            showStatus('保存失败: ' + e.message, 'error');
            return false;
        } finally {
            snapshotBtn.disabled = false;
            saveAllBtn.disabled = false;
        }
    }

    // Save both bookmark and snapshot
    async function saveAll() {
        const bookmarkOk = await saveBookmark();
        if (bookmarkOk) {
            await saveSnapshot();
        }
    }

    // Setup event listeners
    function setupEventListeners() {
        saveBtn.addEventListener('click', saveBookmark);
        snapshotBtn.addEventListener('click', saveSnapshot);
        saveAllBtn.addEventListener('click', saveAll);

        openManagerBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: getServerUrl() });
        });

        settingsToggle.addEventListener('click', () => {
            settingsToggle.classList.toggle('open');
            settingsContent.classList.toggle('hidden');
        });

        toggleTokenBtn.addEventListener('click', () => {
            apiTokenInput.type = apiTokenInput.type === 'password' ? 'text' : 'password';
        });

        saveSettingsBtn.addEventListener('click', async () => {
            await saveSettings();
            showStatus('设置已保存', 'success');
            await checkConnection();
            setTimeout(hideStatus, 1500);
        });

        openSettingsLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: `${getServerUrl()}/settings` });
        });
    }

    init();
})();
