// Content script - 在网页上下文中运行
// 负责处理 SingleFile 调用并返回结果

// 防止重复注入
if (!window.__bookmarksManagerLoaded) {
    window.__bookmarksManagerLoaded = true;

    (function () {
        'use strict';

        const DEFAULT_CAPTURE_TIMEOUT_MS = 120000;
        const FETCH_METHOD = 'bookmarksManager.fetchResource';
        const SINGLE_FILE_DEFAULTS = {
            // 以完整度优先：不主动裁掉隐藏元素/未使用样式/字体，避免文件异常偏小。
            removeHiddenElements: false,
            removeUnusedStyles: false,
            removeUnusedFonts: false,
            compressHTML: true,
            removeFrames: false,
            blockScripts: true,
            saveRawPage: false,
            saveOriginalURLs: true,
            loadDeferredImages: true,
            loadDeferredImagesBeforeFrames: true,
            loadDeferredImagesMaxIdleTime: 1500,
            loadDeferredImagesNativeTimeout: true,
            maxResourceSizeEnabled: false,
        };

        let captureInFlight = false;

        function delay(ms) {
            return new Promise((resolve) => {
                setTimeout(resolve, ms);
            });
        }

        function withTimeout(promise, timeoutMs, errorMessage) {
            return new Promise((resolve, reject) => {
                let settled = false;
                const timeout = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    reject(new Error(errorMessage));
                }, timeoutMs);

                promise.then((value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    resolve(value);
                }).catch((error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        }

        function sendRuntimeMessage(message) {
            return new Promise((resolve, reject) => {
                if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
                    reject(new Error('扩展后台不可用'));
                    return;
                }

                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message || '扩展后台请求失败'));
                        return;
                    }
                    resolve(response);
                });
            });
        }

        function serializeHeaders(headers) {
            if (!headers) return {};
            if (headers instanceof Headers) {
                const result = {};
                headers.forEach((value, key) => {
                    result[key] = value;
                });
                return result;
            }
            if (Array.isArray(headers)) {
                return headers.reduce((result, pair) => {
                    if (Array.isArray(pair) && pair.length >= 2) {
                        result[pair[0]] = pair[1];
                    }
                    return result;
                }, {});
            }
            if (typeof headers === 'object') return { ...headers };
            return {};
        }

        function base64ToUint8Array(base64) {
            const binary = atob(base64 || '');
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        }

        function canUseExtensionFetch(resourceUrl) {
            try {
                const parsed = new URL(resourceUrl, document.baseURI);
                return parsed.protocol === 'http:' || parsed.protocol === 'https:';
            } catch (_error) {
                return false;
            }
        }

        function createSingleFileFetchAdapter() {
            return async (resourceUrl, requestOptions = {}) => {
                const resolvedUrl = new URL(resourceUrl, document.baseURI).href;

                if (!canUseExtensionFetch(resolvedUrl)) {
                    return fetch(resolvedUrl, requestOptions);
                }

                const response = await sendRuntimeMessage({
                    method: FETCH_METHOD,
                    url: resolvedUrl,
                    options: {
                        headers: serializeHeaders(requestOptions.headers),
                        cache: requestOptions.cache,
                        referrerPolicy: requestOptions.referrerPolicy,
                    },
                });

                if (!response || !response.success) {
                    throw new Error(response && response.error ? response.error : `资源抓取失败: ${resolvedUrl}`);
                }

                return new Response(base64ToUint8Array(response.bodyBase64), {
                    status: response.status || 200,
                    statusText: response.statusText || '',
                    headers: response.headers || {},
                });
            };
        }

        // 监听来自 popup 的消息
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.method === 'pingCapture') {
                sendResponse({
                    success: true,
                    ready: true,
                    method: typeof singlefile !== 'undefined' && typeof singlefile.getPageData === 'function' ? 'singlefile' : 'native',
                    backgroundFetch: Boolean(chrome.runtime && chrome.runtime.sendMessage),
                });
                return false;
            }

            if (message.method === 'getPageData') {
                if (captureInFlight) {
                    sendResponse({ success: false, error: '页面已有快照任务在执行，请稍候' });
                    return false;
                }

                captureInFlight = true;
                handleGetPageData(message.options)
                    .then(data => sendResponse({ success: true, data }))
                    .catch(error => sendResponse({ success: false, error: error.message }))
                    .finally(() => {
                        captureInFlight = false;
                    });
                return true; // 异步响应
            }
        });

        async function captureWithSingleFile(options, startTime, docTitle) {
            const fetchAdapter = createSingleFileFetchAdapter();
            const pageData = await singlefile.getPageData(
                {
                    ...SINGLE_FILE_DEFAULTS,
                    ...options,
                    saveRawPage: false,
                },
                {
                    fetch: fetchAdapter,
                    frameFetch: fetchAdapter,
                },
            );

            if (!pageData || !pageData.content) {
                throw new Error('SingleFile 未返回页面内容');
            }

            return {
                content: pageData.content,
                title: docTitle,
                method: 'singlefile',
                elapsed: Date.now() - startTime,
            };
        }

        function captureWithNativeSerializer(startTime, docTitle) {
            const doctype = document.doctype;
            const doctypeStr = doctype
                ? `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ''}${doctype.systemId ? ` "${doctype.systemId}"` : ''}>`
                : '<!DOCTYPE html>';
            const html = doctypeStr + '\n' + document.documentElement.outerHTML;

            return {
                content: html,
                title: docTitle,
                method: 'native',
                elapsed: Date.now() - startTime,
            };
        }

        async function handleGetPageData(options = {}) {
            const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
                ? options.timeoutMs
                : DEFAULT_CAPTURE_TIMEOUT_MS;
            const testDelayMs = Number.isFinite(options.testDelayMs) && options.testDelayMs > 0
                ? options.testDelayMs
                : 0;
            const docTitle = document.title || 'untitled';
            const startTime = Date.now();
            const singleFileOptions = { ...options };
            const allowNativeFallback = singleFileOptions.allowNativeFallback === true;
            delete singleFileOptions.timeoutMs;
            delete singleFileOptions.testDelayMs;
            delete singleFileOptions.allowNativeFallback;

            return withTimeout((async () => {
                if (testDelayMs > 0) {
                    await delay(testDelayMs);
                }

                if (typeof singlefile !== 'undefined' && typeof singlefile.getPageData === 'function') {
                    try {
                        return await captureWithSingleFile(singleFileOptions, startTime, docTitle);
                    } catch (error) {
                        if (!allowNativeFallback) {
                            const message = error instanceof Error ? error.message : String(error || '未知错误');
                            throw new Error(`SingleFile 捕获失败：${message}`);
                        }
                    }
                }

                return captureWithNativeSerializer(startTime, docTitle);
            })(), timeoutMs, '页面处理超时，请刷新页面后重试');
        }
    })();
}
