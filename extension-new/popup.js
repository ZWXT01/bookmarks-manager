// Bookmarks Manager Extension popup UI
(function () {
    'use strict';

    const titleInput = document.getElementById('title');
    const urlInput = document.getElementById('url');
    const categorySelect = document.getElementById('category');
    const saveBtn = document.getElementById('save-btn');
    const snapshotBtn = document.getElementById('snapshot-btn');
    const saveAllBtn = document.getElementById('save-all-btn');
    const openManagerBtn = document.getElementById('open-manager-btn');
    const statusDiv = document.getElementById('status');
    const statusIcon = document.getElementById('status-icon');
    const statusTitle = document.getElementById('status-title');
    const statusMessage = document.getElementById('status-message');
    const connectionStatus = document.getElementById('connection-status');
    const connectionDot = document.getElementById('connection-dot');
    const connectionText = document.getElementById('connection-text');
    const connectionDetail = document.getElementById('connection-detail');
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsSummary = document.getElementById('settings-summary');
    const settingsContent = document.getElementById('settings-content');
    const selectionSummary = document.getElementById('selection-summary');
    const serverUrlInput = document.getElementById('server-url');
    const apiTokenInput = document.getElementById('api-token');
    const toggleTokenBtn = document.getElementById('toggle-token-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const openSettingsLink = document.getElementById('open-settings-link');

    const ACTION_BUTTONS = [saveBtn, snapshotBtn, saveAllBtn];
    const BUTTON_COPY = new Map(ACTION_BUTTONS.map((button) => [
        button,
        {
            title: button.querySelector('.btn-title')?.textContent || '',
            subtitle: button.querySelector('.btn-subtitle')?.textContent || '',
        },
    ]));
    const STATUS_META = {
        loading: { icon: '…', title: '处理中' },
        success: { icon: '✓', title: '操作完成' },
        error: { icon: '!', title: '需要处理' },
    };

    let categories = [];
    let isConnected = false;
    let lastConnectedAt = 0;
    let hideStatusTimer = null;

    function getRuntimeTestState() {
        const state = window.__BOOKMARKS_MANAGER_RUNTIME_TEST__;
        return state && typeof state === 'object' ? state : null;
    }

    function getServerUrl() {
        return serverUrlInput.value.trim().replace(/\/$/, '') || 'http://localhost:8080';
    }

    function getServerLabel() {
        const serverUrl = getServerUrl();
        try {
            return new URL(serverUrl).host;
        } catch (_error) {
            return serverUrl.replace(/^https?:\/\//, '') || '未配置服务器';
        }
    }

    function setSettingsOpen(open) {
        settingsToggle.classList.toggle('open', open);
        settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        settingsContent.classList.toggle('hidden', !open);
    }

    function updateSettingsSummary() {
        const serverLabel = getServerLabel();
        const hasToken = Boolean(apiTokenInput.value.trim());

        if (!hasToken) {
            settingsSummary.textContent = `${serverLabel} · 未配置 Token`;
            return;
        }

        if (isConnected) {
            settingsSummary.textContent = `${serverLabel} · 已连接`;
            return;
        }

        settingsSummary.textContent = `${serverLabel} · 待验证`;
    }

    function getSelectedCategoryId() {
        const raw = categorySelect.value;
        if (!raw) return null;

        const parsed = Number(raw);
        if (Number.isInteger(parsed)) return parsed;

        const matched = categories.find((cat) => String(cat.id) === raw || cat.fullPath === raw || cat.name === raw);
        return matched ? matched.id : null;
    }

    function getSelectedCategoryLabel() {
        const selectedId = getSelectedCategoryId();
        if (selectedId == null) return null;

        const matched = categories.find((cat) => cat.id === selectedId);
        return matched ? (matched.fullPath || matched.name) : null;
    }

    function updateSelectionSummary() {
        const label = getSelectedCategoryLabel();
        selectionSummary.textContent = label
            ? `将保存到 ${label}`
            : '未选择分类，将保存到未分类。';
    }

    function updateCategorySelect() {
        const previousValue = categorySelect.value;
        categorySelect.innerHTML = '<option value="">-- 选择分类 --</option>';

        categories.forEach((cat) => {
            const option = document.createElement('option');
            option.value = String(cat.id);
            option.textContent = cat.fullPath || cat.name;
            categorySelect.appendChild(option);
        });

        if (previousValue && Array.from(categorySelect.options).some((option) => option.value === previousValue)) {
            categorySelect.value = previousValue;
        }

        updateSelectionSummary();
    }

    function hideStatus() {
        if (hideStatusTimer) {
            clearTimeout(hideStatusTimer);
            hideStatusTimer = null;
        }
        statusDiv.className = 'alert hidden';
    }

    function showStatus(message, type) {
        const meta = STATUS_META[type] || STATUS_META.loading;
        hideStatus();
        statusDiv.className = `alert ${type}`;
        statusIcon.textContent = meta.icon;
        statusTitle.textContent = meta.title;
        statusMessage.textContent = message;
    }

    function scheduleStatusHide(delayMs) {
        if (hideStatusTimer) {
            clearTimeout(hideStatusTimer);
        }
        hideStatusTimer = setTimeout(() => {
            hideStatus();
        }, delayMs);
    }

    function updateConnectionStatus(status) {
        connectionDot.className = 'dot';
        connectionStatus.className = 'status-badge';

        if (status === 'connected') {
            connectionDot.classList.add('connected');
            connectionStatus.classList.add('is-connected');
            connectionText.textContent = '已连接';
            connectionDetail.textContent = categories.length > 0
                ? `已同步 ${categories.length} 个分类`
                : '连接正常，可直接保存';
            isConnected = true;
        } else if (status === 'loading') {
            connectionDot.classList.add('loading');
            connectionStatus.classList.add('is-loading');
            connectionText.textContent = '连接中';
            connectionDetail.textContent = '正在检查服务端配置';
            isConnected = false;
        } else if (status === 'no_token') {
            connectionStatus.classList.add('is-warning');
            connectionText.textContent = '待配置';
            connectionDetail.textContent = '请先保存服务器地址和 Token';
            isConnected = false;
        } else {
            connectionStatus.classList.add('is-disconnected');
            connectionText.textContent = '未连接';
            connectionDetail.textContent = apiTokenInput.value.trim()
                ? '请检查地址、Token 或服务状态'
                : '尚未保存 Token';
            isConnected = false;
        }

        updateSettingsSummary();
    }

    function setButtonCopy(button, title, subtitle) {
        const titleNode = button.querySelector('.btn-title');
        const subtitleNode = button.querySelector('.btn-subtitle');
        if (titleNode) titleNode.textContent = title;
        if (subtitleNode) subtitleNode.textContent = subtitle;
    }

    function setActionState(mode) {
        ACTION_BUTTONS.forEach((button) => {
            const copy = BUTTON_COPY.get(button);
            if (copy) {
                setButtonCopy(button, copy.title, copy.subtitle);
            }
            button.disabled = Boolean(mode);
            button.classList.remove('is-busy');
            button.removeAttribute('aria-busy');
        });

        if (!mode) return;

        const targetButton = mode === 'save'
            ? saveBtn
            : mode === 'snapshot'
                ? snapshotBtn
                : saveAllBtn;

        targetButton.classList.add('is-busy');
        targetButton.setAttribute('aria-busy', 'true');

        if (mode === 'save') {
            setButtonCopy(saveBtn, '收藏中...', '正在发送书签请求');
        } else if (mode === 'snapshot') {
            setButtonCopy(snapshotBtn, '存档中...', '正在抓取页面快照');
        } else if (mode === 'saveAll') {
            setButtonCopy(saveAllBtn, '处理中...', '依次保存书签与快照');
        }
    }

    async function loadSettings() {
        await new Promise((resolve) => {
            chrome.storage.sync.get(['serverUrl', 'apiToken'], (result) => {
                serverUrlInput.value = result.serverUrl || 'http://localhost:8080';
                apiTokenInput.value = result.apiToken || '';
                resolve();
            });
        });
        updateSettingsSummary();
    }

    async function loadConnectionCache() {
        await new Promise((resolve) => {
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

    async function saveConnectionCache() {
        lastConnectedAt = Date.now();
        await new Promise((resolve) => {
            chrome.storage.local.set({
                lastConnectedAt,
                cachedCategories: categories,
            }, resolve);
        });
    }

    async function saveSettings() {
        const serverUrl = getServerUrl();
        const apiToken = apiTokenInput.value.trim();

        await new Promise((resolve) => {
            chrome.storage.sync.set({ serverUrl, apiToken }, resolve);
        });

        updateSettingsSummary();
    }

    async function resolveTargetTab() {
        const runtimeState = getRuntimeTestState();

        if (runtimeState && Number.isInteger(runtimeState.targetTabId)) {
            try {
                const tab = await chrome.tabs.get(runtimeState.targetTabId);
                if (tab) return tab;
            } catch (_error) {
                // Fall through to URL / active-tab lookup.
            }
        }

        if (runtimeState && runtimeState.targetUrl) {
            try {
                const matches = await chrome.tabs.query({ url: runtimeState.targetUrl });
                const matchedTab = matches.find((tab) => tab.url === runtimeState.targetUrl) || matches[0];
                if (matchedTab) return matchedTab;
            } catch (_error) {
                // Fall through to active-tab lookup.
            }
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab || null;
    }

    async function getCurrentTab() {
        const runtimeState = getRuntimeTestState();

        try {
            const tab = await resolveTargetTab();
            if (tab) {
                titleInput.value = tab.title || runtimeState?.targetTitle || '';
                urlInput.value = tab.url || runtimeState?.targetUrl || '';
            }
        } catch (_error) {
            if (runtimeState) {
                titleInput.value = runtimeState.targetTitle || '';
                urlInput.value = runtimeState.targetUrl || '';
            }
        }
    }

    function getHeaders() {
        const apiToken = apiTokenInput.value.trim();
        if (!apiToken) throw new Error('API Token 未配置');
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
        };
    }

    async function checkConnection() {
        if (!apiTokenInput.value.trim()) {
            updateConnectionStatus('no_token');
            return;
        }

        updateConnectionStatus('loading');

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${getServerUrl()}/api/categories`, {
                headers: getHeaders(),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!response.ok) {
                updateConnectionStatus('disconnected');
                return;
            }

            const data = await response.json();
            categories = data.categories || [];
            updateCategorySelect();
            updateConnectionStatus('connected');
            await saveConnectionCache();
        } catch (_error) {
            updateConnectionStatus('disconnected');
        }
    }

    async function silentCheckConnection() {
        if (!apiTokenInput.value.trim()) {
            updateConnectionStatus('no_token');
            return;
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${getServerUrl()}/api/categories`, {
                headers: getHeaders(),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!response.ok) {
                updateConnectionStatus('disconnected');
                return;
            }

            const data = await response.json();
            categories = data.categories || [];
            updateCategorySelect();
            updateConnectionStatus('connected');
            await saveConnectionCache();
        } catch (_error) {
            // Keep optimistic connection state if the silent probe fails transiently.
            updateSettingsSummary();
        }
    }

    async function saveBookmark(options) {
        const managed = Boolean(options && options.managed);
        const successMessage = options && options.successMessage;
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

        if (!managed) {
            setActionState('save');
        }

        showStatus('正在保存书签…', 'loading');

        try {
            const response = await fetch(`${getServerUrl()}/api/bookmarks`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ url, title, category_id: categoryId }),
            });
            const data = await response.json();

            if (!response.ok) {
                showStatus(data.error || '保存失败', 'error');
                return false;
            }

            showStatus(successMessage || '书签保存成功', 'success');
            if (!managed) {
                scheduleStatusHide(2200);
            }
            return true;
        } catch (error) {
            showStatus(`保存失败: ${error.message}`, 'error');
            return false;
        } finally {
            if (!managed) {
                setActionState(null);
            }
        }
    }

    async function saveSnapshot(options) {
        const managed = Boolean(options && options.managed);
        const successMessage = options && options.successMessage;
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

        if (!managed) {
            setActionState('snapshot');
        }

        try {
            const tab = await resolveTargetTab();
            if (!tab || !tab.id) {
                throw new Error('无法获取当前标签页');
            }

            showStatus('正在准备页面采集…', 'loading');
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['lib/single-file.js', 'content.js'],
                });
            } catch (_error) {
                // Ignore duplicate injection warnings.
            }

            showStatus('正在处理网页内容…', 'loading');

            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('处理超时，请刷新页面后重试'));
                }, 180000);

                chrome.tabs.sendMessage(tab.id, { method: 'getPageData', options: {} }, (message) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message || '无法连接到页面'));
                        return;
                    }
                    resolve(message);
                });
            });

            if (!response || !response.success || !response.data || !response.data.content) {
                throw new Error(response?.error || '获取页面数据失败');
            }

            const pageData = response.data;
            const sizeMB = (pageData.content.length / 1024 / 1024).toFixed(2);
            const elapsed = pageData.elapsed ? ` · ${(pageData.elapsed / 1000).toFixed(1)}s` : '';
            showStatus(`正在上传快照 ${sizeMB} MB…`, 'loading');

            const uploadResponse = await fetch(`${getServerUrl()}/api/snapshots`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({
                    url,
                    title: title || pageData.title || 'untitled',
                    content: pageData.content,
                }),
            });

            const data = await uploadResponse.json();
            if (!uploadResponse.ok) {
                showStatus(data.error || '保存失败', 'error');
                return false;
            }

            const method = pageData.method === 'singlefile' ? 'SingleFile' : '原生';
            showStatus(successMessage || `快照已保存 · ${method}${elapsed}`, 'success');
            if (!managed) {
                scheduleStatusHide(3200);
            }
            return true;
        } catch (error) {
            showStatus(`保存失败: ${error.message}`, 'error');
            return false;
        } finally {
            if (!managed) {
                setActionState(null);
            }
        }
    }

    async function saveAll() {
        if (!urlInput.value.trim()) {
            showStatus('请输入网址', 'error');
            return;
        }

        if (!isConnected) {
            showStatus('未连接到服务器', 'error');
            return;
        }

        setActionState('saveAll');

        try {
            const bookmarkOk = await saveBookmark({
                managed: true,
                successMessage: '书签已保存，继续生成快照…',
            });

            if (!bookmarkOk) return;

            const snapshotOk = await saveSnapshot({
                managed: true,
                successMessage: '已完成收藏和存档',
            });
            if (snapshotOk) {
                scheduleStatusHide(3200);
            }
        } finally {
            setActionState(null);
        }
    }

    function setupEventListeners() {
        categorySelect.addEventListener('change', updateSelectionSummary);

        saveBtn.addEventListener('click', () => {
            void saveBookmark();
        });
        snapshotBtn.addEventListener('click', () => {
            void saveSnapshot();
        });
        saveAllBtn.addEventListener('click', () => {
            void saveAll();
        });

        openManagerBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: getServerUrl() });
        });

        settingsToggle.addEventListener('click', () => {
            setSettingsOpen(settingsContent.classList.contains('hidden'));
        });

        toggleTokenBtn.addEventListener('click', () => {
            const visible = apiTokenInput.type === 'password';
            apiTokenInput.type = visible ? 'text' : 'password';
            toggleTokenBtn.textContent = visible ? '隐藏' : '显示';
        });

        serverUrlInput.addEventListener('input', updateSettingsSummary);
        apiTokenInput.addEventListener('input', updateSettingsSummary);

        saveSettingsBtn.addEventListener('click', async () => {
            saveSettingsBtn.disabled = true;
            showStatus('正在保存连接设置…', 'loading');

            try {
                await saveSettings();
                await checkConnection();
                showStatus(isConnected ? '设置已保存并连接成功' : '设置已保存，请检查连接状态', isConnected ? 'success' : 'error');
                scheduleStatusHide(isConnected ? 1800 : 2600);
            } finally {
                saveSettingsBtn.disabled = false;
            }
        });

        openSettingsLink.addEventListener('click', (event) => {
            event.preventDefault();
            chrome.tabs.create({ url: `${getServerUrl()}/settings` });
        });
    }

    async function init() {
        await loadSettings();
        await loadConnectionCache();
        await getCurrentTab();
        updateSelectionSummary();

        const apiToken = apiTokenInput.value.trim();
        if (!apiToken) {
            updateConnectionStatus('no_token');
            setSettingsOpen(true);
        } else if (lastConnectedAt > Date.now() - 5 * 60 * 1000) {
            updateConnectionStatus('connected');
            void silentCheckConnection();
        } else {
            await checkConnection();
        }

        setupEventListeners();
    }

    void init();
})();
