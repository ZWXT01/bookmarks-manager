// Content script - 在网页上下文中运行
// 负责处理 SingleFile 调用并返回结果

// 防止重复注入
if (!window.__bookmarksManagerLoaded) {
    window.__bookmarksManagerLoaded = true;

    (function () {
        'use strict';

        const DEFAULT_CAPTURE_TIMEOUT_MS = 90000;
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

        // 监听来自 popup 的消息
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.method === 'pingCapture') {
                sendResponse({
                    success: true,
                    ready: true,
                    method: typeof singlefile !== 'undefined' && typeof singlefile.getPageData === 'function' ? 'singlefile' : 'native',
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
            delete singleFileOptions.timeoutMs;
            delete singleFileOptions.testDelayMs;

            return withTimeout((async () => {
                if (testDelayMs > 0) {
                    await delay(testDelayMs);
                }

                // 尝试使用 SingleFile
                if (typeof singlefile !== 'undefined' && typeof singlefile.getPageData === 'function') {
                    try {
                        const pageData = await singlefile.getPageData({
                            removeHiddenElements: singleFileOptions.removeHiddenElements !== false,
                            removeUnusedStyles: singleFileOptions.removeUnusedStyles !== false,
                            removeUnusedFonts: singleFileOptions.removeUnusedFonts !== false,
                            compressHTML: singleFileOptions.compressHTML !== false,
                            removeFrames: singleFileOptions.removeFrames !== false,
                            blockScripts: singleFileOptions.blockScripts !== false,
                            saveRawPage: false,
                            ...singleFileOptions
                        });

                        if (pageData && pageData.content) {
                            return {
                                content: pageData.content,
                                title: docTitle,
                                method: 'singlefile',
                                elapsed: Date.now() - startTime
                            };
                        }
                    } catch (_error) {
                        // Fall through to native
                    }
                }

                // Fallback: 原生 DOM 序列化
                const doctype = document.doctype;
                const doctypeStr = doctype
                    ? `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ''}${doctype.systemId ? ` "${doctype.systemId}"` : ''}>`
                    : '<!DOCTYPE html>';
                const html = doctypeStr + '\n' + document.documentElement.outerHTML;

                return {
                    content: html,
                    title: docTitle,
                    method: 'native',
                    elapsed: Date.now() - startTime
                };
            })(), timeoutMs, '页面处理超时，请刷新页面后重试');
        }
    })();
}
