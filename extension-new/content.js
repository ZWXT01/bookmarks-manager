// Content script - 在网页上下文中运行
// 负责处理 SingleFile 调用并返回结果

// 防止重复注入
if (!window.__bookmarksManagerLoaded) {
    window.__bookmarksManagerLoaded = true;

    (function () {
        'use strict';

        // 监听来自 popup 的消息
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.method === 'getPageData') {
                handleGetPageData(message.options)
                    .then(data => sendResponse({ success: true, data }))
                    .catch(error => sendResponse({ success: false, error: error.message }));
                return true; // 异步响应
            }
        });

        async function handleGetPageData(options = {}) {
            const docTitle = document.title || 'untitled';
            const startTime = Date.now();

            // 尝试使用 SingleFile
            if (typeof singlefile !== 'undefined' && typeof singlefile.getPageData === 'function') {
                try {
                    const pageData = await singlefile.getPageData({
                        removeHiddenElements: options.removeHiddenElements !== false,
                        removeUnusedStyles: options.removeUnusedStyles !== false,
                        removeUnusedFonts: options.removeUnusedFonts !== false,
                        compressHTML: options.compressHTML !== false,
                        removeFrames: options.removeFrames !== false,
                        blockScripts: options.blockScripts !== false,
                        saveRawPage: false,
                        ...options
                    });

                    if (pageData && pageData.content) {
                        return {
                            content: pageData.content,
                            title: docTitle,
                            method: 'singlefile',
                            elapsed: Date.now() - startTime
                        };
                    }
                } catch (e) {
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
        }
    })();
}
