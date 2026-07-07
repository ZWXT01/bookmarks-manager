// Background service worker for Bookmarks Manager Extension
// Provides extension-context resource fetches and keeps long-running snapshot
// jobs alive after the action popup is closed.
(function () {
    'use strict';

    const FETCH_METHOD = 'bookmarksManager.fetchResource';
    const START_JOB_METHOD = 'bookmarksManager.startJob';
    const GET_JOB_STATE_METHOD = 'bookmarksManager.getJobState';
    const CLEAR_JOB_STATE_METHOD = 'bookmarksManager.clearJobState';
    const JOB_STATE_KEY = 'bookmarksManager.jobState';
    const CAPTURE_BRIDGE_TIMEOUT_MS = 1200;
    const SNAPSHOT_CAPTURE_TIMEOUT_MS = 120000;
    const STALE_RUNNING_JOB_MS = 8 * 60 * 1000;
    const CAPTURE_BRIDGE_FILES = [
        'lib/single-file.js',
        'lib/single-file-bootstrap.js',
        'lib/single-file-frames.js',
        'content.js',
    ];

    const lazyTimers = new Map();
    const captureBridgeReadyTabs = new Set();
    const workerSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let activeJobState = null;
    let activeJobPromise = null;

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    function normalizeHeaders(rawHeaders) {
        const headers = new Headers();
        if (!rawHeaders || typeof rawHeaders !== 'object') return headers;

        Object.entries(rawHeaders).forEach(([name, value]) => {
            if (!name || value == null) return;
            const lowerName = String(name).toLowerCase();
            // Let the browser manage forbidden/sensitive headers.
            if (['cookie', 'host', 'origin', 'referer', 'user-agent'].includes(lowerName)) return;
            headers.set(name, String(value));
        });
        return headers;
    }

    async function fetchResource(message) {
        const resourceUrl = typeof message.url === 'string' ? message.url : '';
        if (!resourceUrl) throw new Error('缺少资源 URL');

        const options = message.options && typeof message.options === 'object' ? message.options : {};
        const response = await fetch(resourceUrl, {
            method: 'GET',
            headers: normalizeHeaders(options.headers),
            credentials: 'include',
            cache: options.cache || 'force-cache',
            redirect: 'follow',
            referrerPolicy: options.referrerPolicy || 'strict-origin-when-cross-origin',
        });

        const buffer = await response.arrayBuffer();
        const headers = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });

        return {
            success: true,
            status: response.status,
            statusText: response.statusText,
            url: response.url || resourceUrl,
            headers,
            bodyBase64: arrayBufferToBase64(buffer),
        };
    }

    function getLazyTimerKey(sender, type) {
        const tabId = sender && sender.tab ? sender.tab.id : 'no-tab';
        const frameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : 0;
        return `${tabId}:${frameId}:${type || 'default'}`;
    }

    function clearLazyTimer(sender, type) {
        const key = getLazyTimerKey(sender, type);
        const existing = lazyTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            lazyTimers.delete(key);
        }
    }

    function setLazyTimer(message, sender) {
        clearLazyTimer(sender, message.type);
        const key = getLazyTimerKey(sender, message.type);
        const delay = Number.isFinite(message.delay) && message.delay > 0 ? message.delay : 0;
        const tabId = sender && sender.tab ? sender.tab.id : null;
        const frameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : 0;
        if (tabId == null) return;

        const timer = setTimeout(() => {
            lazyTimers.delete(key);
            chrome.tabs.sendMessage(
                tabId,
                { method: 'singlefile.lazyTimeout.onTimeout', type: message.type },
                { frameId },
                () => void chrome.runtime.lastError,
            );
        }, delay);
        lazyTimers.set(key, timer);
    }

    function storageGet(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result || {}));
        });
    }

    function storageSet(items) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(items, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || '写入扩展状态失败'));
                    return;
                }
                resolve();
            });
        });
    }

    function storageRemove(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || '清理扩展状态失败'));
                    return;
                }
                resolve();
            });
        });
    }

    async function getStoredJobState() {
        const result = await storageGet([JOB_STATE_KEY]);
        const state = result[JOB_STATE_KEY];
        return state && typeof state === 'object' ? state : null;
    }

    function describeJob(mode) {
        if (mode === 'save') return '正在保存书签';
        if (mode === 'snapshot') return '正在生成快照';
        return '正在收藏并存档';
    }

    function sanitizeJobPayload(mode, payload) {
        const data = payload && typeof payload === 'object' ? payload : {};
        const rawCategoryId = data.categoryId;
        const categoryId = Number.isInteger(rawCategoryId) ? rawCategoryId : null;
        return {
            mode,
            tabId: Number.isInteger(data.tabId) ? data.tabId : null,
            url: typeof data.url === 'string' ? data.url : '',
            title: typeof data.title === 'string' ? data.title : '',
            categoryId,
            serverUrl: typeof data.serverUrl === 'string' ? data.serverUrl.replace(/\/$/, '') : '',
            apiToken: typeof data.apiToken === 'string' ? data.apiToken : '',
            captureOptions: data.captureOptions && typeof data.captureOptions === 'object' ? data.captureOptions : {},
        };
    }

    function makePublicJobState(jobId, payload, patch = {}) {
        const now = Date.now();
        return {
            id: jobId,
            mode: payload.mode,
            status: 'running',
            stage: 'queued',
            message: describeJob(payload.mode),
            startedAt: now,
            updatedAt: now,
            workerSessionId,
            tabId: payload.tabId,
            url: payload.url,
            title: payload.title,
            ...patch,
        };
    }

    async function updateActiveJob(jobId, patch) {
        if (!activeJobState || activeJobState.id !== jobId) return activeJobState;
        activeJobState = {
            ...activeJobState,
            ...patch,
            updatedAt: Date.now(),
        };
        await storageSet({ [JOB_STATE_KEY]: activeJobState });
        return activeJobState;
    }

    function getHeaders(payload) {
        if (!payload.apiToken) throw new Error('API Token 未配置');
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${payload.apiToken}`,
        };
    }

    function requireServerUrl(payload) {
        if (!payload.serverUrl) throw new Error('服务器地址未配置');
        return payload.serverUrl;
    }

    function requirePageUrl(payload) {
        if (!payload.url) throw new Error('请输入网址');
        return payload.url;
    }

    async function parseJsonResponse(response) {
        try {
            return await response.json();
        } catch (_error) {
            return {};
        }
    }

    async function saveBookmark(payload) {
        const serverUrl = requireServerUrl(payload);
        const url = requirePageUrl(payload);
        const response = await fetch(`${serverUrl}/api/bookmarks`, {
            method: 'POST',
            headers: getHeaders(payload),
            body: JSON.stringify({
                url,
                title: payload.title,
                category_id: payload.categoryId,
            }),
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) {
            throw new Error(data.error || `保存失败(${response.status})`);
        }
        return data;
    }

    function isCaptureSupportedUrl(rawUrl) {
        if (!rawUrl) return false;
        try {
            const parsed = new URL(rawUrl);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (_error) {
            return false;
        }
    }

    function normalizeCaptureError(error, fallbackMessage) {
        const message = error instanceof Error ? error.message : String(error || fallbackMessage || '未知错误');

        if (!message) return fallbackMessage || '未知错误';
        if (message.includes('当前页面不支持完整快照') || message.includes('页面处理超时')) return message;

        if (
            message.includes('Cannot access contents of url') ||
            message.includes('The extensions gallery cannot be scripted') ||
            message.includes('Missing host permission')
        ) {
            return '当前页面不支持完整快照，请切换到普通网页后重试';
        }

        if (
            message.includes('Receiving end does not exist') ||
            message.includes('Could not establish connection') ||
            message.includes('message port closed')
        ) {
            return '页面连接已失效，请刷新页面后重试';
        }

        if (message.includes('No tab with id') || message.includes('Tabs cannot be edited right now')) {
            return '目标标签页不可用，请重新打开页面后重试';
        }

        return message;
    }

    function tabsGet(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || '无法获取当前标签页'));
                    return;
                }
                resolve(tab);
            });
        });
    }

    function sendTabMessage(tabId, message, timeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('页面处理超时，请刷新页面后重试'));
            }, timeoutMs);

            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);

                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || '无法连接到页面'));
                    return;
                }

                resolve(response);
            });
        });
    }

    function executeCaptureBridge(tabId) {
        return new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: { tabId },
                files: CAPTURE_BRIDGE_FILES,
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || '页面连接失败'));
                    return;
                }
                resolve();
            });
        });
    }

    async function ensureCaptureBridge(tabId) {
        if (captureBridgeReadyTabs.has(tabId)) {
            try {
                const ready = await sendTabMessage(tabId, { method: 'pingCapture' }, CAPTURE_BRIDGE_TIMEOUT_MS);
                if (ready && ready.success) return;
            } catch (_error) {
                captureBridgeReadyTabs.delete(tabId);
            }
        }

        try {
            const ready = await sendTabMessage(tabId, { method: 'pingCapture' }, CAPTURE_BRIDGE_TIMEOUT_MS);
            if (ready && ready.success) {
                captureBridgeReadyTabs.add(tabId);
                return;
            }
        } catch (_error) {
            // Fall through to bridge injection.
        }

        try {
            await executeCaptureBridge(tabId);
            const ready = await sendTabMessage(tabId, { method: 'pingCapture' }, CAPTURE_BRIDGE_TIMEOUT_MS);
            if (!ready || !ready.success) {
                throw new Error(ready && ready.error ? ready.error : '页面连接未就绪');
            }
            captureBridgeReadyTabs.add(tabId);
        } catch (error) {
            captureBridgeReadyTabs.delete(tabId);
            throw new Error(normalizeCaptureError(error, '页面连接失败'));
        }
    }

    async function prepareSnapshotTarget(payload) {
        if (!Number.isInteger(payload.tabId)) {
            throw new Error('无法获取当前标签页');
        }

        const tab = await tabsGet(payload.tabId);
        const tabUrl = tab && tab.url ? tab.url : payload.url;
        if (!isCaptureSupportedUrl(tabUrl)) {
            throw new Error('当前页面不支持完整快照，请切换到普通网页后重试');
        }

        await ensureCaptureBridge(payload.tabId);
        return tab;
    }

    async function capturePageData(payload) {
        const runtimeCaptureOptions = payload.captureOptions || {};
        const captureTimeout = Number.isFinite(runtimeCaptureOptions.timeoutMs) && runtimeCaptureOptions.timeoutMs > 0
            ? runtimeCaptureOptions.timeoutMs
            : SNAPSHOT_CAPTURE_TIMEOUT_MS;
        const response = await sendTabMessage(
            payload.tabId,
            {
                method: 'getPageData',
                options: {
                    timeoutMs: captureTimeout,
                    testDelayMs: runtimeCaptureOptions.testDelayMs,
                },
            },
            captureTimeout + 2000,
        );

        if (!response || !response.success || !response.data || !response.data.content) {
            throw new Error(response && response.error ? response.error : '获取页面数据失败');
        }

        return response.data;
    }

    async function uploadSnapshot(payload, pageData) {
        const serverUrl = requireServerUrl(payload);
        const url = requirePageUrl(payload);
        const response = await fetch(`${serverUrl}/api/snapshots`, {
            method: 'POST',
            headers: getHeaders(payload),
            body: JSON.stringify({
                url,
                title: payload.title || pageData.title || 'untitled',
                content: pageData.content,
            }),
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) {
            throw new Error(data.error || `保存失败(${response.status})`);
        }
        return data;
    }

    function formatSnapshotMethod(method) {
        if (method === 'singlefile') return 'SingleFile';
        if (method === 'dom-embedded') return 'DOM增强';
        return '原生';
    }

    async function captureAndUploadSnapshot(jobId, payload) {
        await updateActiveJob(jobId, {
            stage: 'preparing',
            message: '正在校验页面快照环境…',
        });
        await prepareSnapshotTarget(payload);

        await updateActiveJob(jobId, {
            stage: 'capturing',
            message: '正在处理网页内容…',
        });
        const pageData = await capturePageData(payload);
        const sizeMB = (pageData.content.length / 1024 / 1024).toFixed(2);
        const elapsed = pageData.elapsed ? ` · ${(pageData.elapsed / 1000).toFixed(1)}s` : '';

        await updateActiveJob(jobId, {
            stage: 'uploading',
            message: `正在上传快照 ${sizeMB} MB…`,
            diagnostics: {
                sizeMB,
                method: pageData.method || 'native',
                elapsedMs: pageData.elapsed || null,
            },
        });
        await uploadSnapshot(payload, pageData);

        return {
            methodLabel: formatSnapshotMethod(pageData.method),
            elapsed,
            sizeMB,
        };
    }

    async function runJob(jobId, payload) {
        let bookmarkSaved = false;
        try {
            if (payload.mode === 'save') {
                await updateActiveJob(jobId, { stage: 'saving-bookmark', message: '正在保存书签…' });
                await saveBookmark(payload);
                await updateActiveJob(jobId, {
                    status: 'success',
                    stage: 'done',
                    message: '书签保存成功',
                });
                return;
            }

            if (payload.mode === 'saveAll') {
                await updateActiveJob(jobId, { stage: 'saving-bookmark', message: '正在保存书签…' });
                await saveBookmark(payload);
                bookmarkSaved = true;
                await updateActiveJob(jobId, { stage: 'bookmark-saved', message: '书签已保存，继续生成快照…' });
                await captureAndUploadSnapshot(jobId, payload);
                await updateActiveJob(jobId, {
                    status: 'success',
                    stage: 'done',
                    message: '已完成收藏和存档',
                });
                return;
            }

            if (payload.mode === 'snapshot') {
                const snapshotResult = await captureAndUploadSnapshot(jobId, payload);
                await updateActiveJob(jobId, {
                    status: 'success',
                    stage: 'done',
                    message: `快照已保存 · ${snapshotResult.methodLabel}${snapshotResult.elapsed}`,
                });
                return;
            }

            throw new Error('未知操作类型');
        } catch (error) {
            const normalizedMessage = normalizeCaptureError(error, '操作失败');
            await updateActiveJob(jobId, {
                status: 'error',
                stage: 'failed',
                message: payload.mode === 'saveAll' && bookmarkSaved
                    ? `书签已保存，但快照失败：${normalizedMessage}`
                    : payload.mode === 'snapshot'
                        ? `保存失败: ${normalizedMessage}`
                        : normalizedMessage,
                error: normalizedMessage,
            });
        } finally {
            if (activeJobState && activeJobState.id === jobId) {
                activeJobPromise = null;
            }
        }
    }

    async function startJob(message) {
        const mode = message.mode === 'save' || message.mode === 'snapshot' || message.mode === 'saveAll'
            ? message.mode
            : 'snapshot';

        if (activeJobPromise && activeJobState && activeJobState.status === 'running') {
            return { success: true, job: activeJobState, alreadyRunning: true };
        }

        const storedJob = await getStoredJobState();
        if (
            storedJob &&
            storedJob.status === 'running' &&
            (!activeJobPromise || storedJob.id !== (activeJobState && activeJobState.id) || Date.now() - (storedJob.updatedAt || 0) > STALE_RUNNING_JOB_MS)
        ) {
            await storageSet({
                [JOB_STATE_KEY]: {
                    ...storedJob,
                    status: 'error',
                    stage: 'failed',
                    message: '上一次后台任务已中断，请重试',
                    updatedAt: Date.now(),
                },
            });
        }

        const payload = sanitizeJobPayload(mode, message.payload);
        const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        activeJobState = makePublicJobState(jobId, payload);
        await storageSet({ [JOB_STATE_KEY]: activeJobState });

        activeJobPromise = runJob(jobId, payload);
        return { success: true, job: activeJobState };
    }

    async function getJobState() {
        if (activeJobState && activeJobState.status === 'running') {
            return { success: true, job: activeJobState };
        }

        const storedJob = await getStoredJobState();
        if (storedJob && storedJob.status === 'running') {
            const staleJob = {
                ...storedJob,
                status: 'error',
                stage: 'failed',
                message: Date.now() - (storedJob.updatedAt || 0) > STALE_RUNNING_JOB_MS
                    ? '上一次后台任务已超时，请重试'
                    : '后台任务已中断，请重试',
                updatedAt: Date.now(),
            };
            activeJobState = staleJob;
            await storageSet({ [JOB_STATE_KEY]: staleJob });
            return { success: true, job: staleJob };
        }

        return { success: true, job: storedJob || null };
    }

    async function clearJobState(message) {
        const storedJob = await getStoredJobState();
        if (storedJob && storedJob.status === 'running') {
            return { success: false, error: '任务仍在运行中' };
        }
        if (!message.jobId || (storedJob && storedJob.id === message.jobId)) {
            await storageRemove([JOB_STATE_KEY]);
            if (!activeJobState || !message.jobId || activeJobState.id === message.jobId) {
                activeJobState = null;
            }
        }
        return { success: true };
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;

        if (message.method === FETCH_METHOD) {
            fetchResource(message)
                .then(sendResponse)
                .catch((error) => {
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : String(error || '资源抓取失败'),
                    });
                });
            return true;
        }

        if (message.method === START_JOB_METHOD) {
            startJob(message)
                .then(sendResponse)
                .catch((error) => {
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : String(error || '启动任务失败'),
                    });
                });
            return true;
        }

        if (message.method === GET_JOB_STATE_METHOD) {
            getJobState()
                .then(sendResponse)
                .catch((error) => {
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : String(error || '读取任务状态失败'),
                    });
                });
            return true;
        }

        if (message.method === CLEAR_JOB_STATE_METHOD) {
            clearJobState(message)
                .then(sendResponse)
                .catch((error) => {
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : String(error || '清理任务状态失败'),
                    });
                });
            return true;
        }

        if (message.method === 'singlefile.lazyTimeout.setTimeout') {
            setLazyTimer(message, sender);
            sendResponse({ success: true });
            return false;
        }

        if (message.method === 'singlefile.lazyTimeout.clearTimeout') {
            clearLazyTimer(sender, message.type);
            sendResponse({ success: true });
            return false;
        }

        return false;
    });
})();
