// Background service worker for Bookmarks Manager Extension
// Provides extension-context network fetches for SingleFile so resources that
// are blocked by page CORS (or need site cookies) can still be embedded.
(function () {
    'use strict';

    const FETCH_METHOD = 'bookmarksManager.fetchResource';
    const lazyTimers = new Map();

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
