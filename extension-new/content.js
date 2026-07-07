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

        function blobToDataUrl(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.addEventListener('load', () => resolve(reader.result));
                reader.addEventListener('error', () => reject(reader.error || new Error('读取资源失败')));
                reader.readAsDataURL(blob);
            });
        }

        async function fetchAsDataUrl(resourceUrl, fetchAdapter) {
            const response = await fetchAdapter(resourceUrl, { cache: 'force-cache' });
            if (!response || response.status >= 400) {
                throw new Error(`资源请求失败(${response ? response.status : '无响应'}): ${resourceUrl}`);
            }
            return await blobToDataUrl(await response.blob());
        }

        function isEmbeddableUrl(resourceUrl) {
            try {
                const parsed = new URL(resourceUrl, document.baseURI);
                return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:' || parsed.protocol === 'blob:';
            } catch (_error) {
                return false;
            }
        }

        async function inlineCssUrls(cssText, baseUrl, fetchAdapter, cache) {
            if (!cssText || !cssText.includes('url(')) return cssText || '';

            const replacements = [];
            const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
            let match;
            while ((match = urlPattern.exec(cssText))) {
                const rawUrl = (match[2] || '').trim();
                if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('#')) continue;
                let resolvedUrl;
                try {
                    resolvedUrl = new URL(rawUrl, baseUrl || document.baseURI).href;
                } catch (_error) {
                    continue;
                }
                if (!isEmbeddableUrl(resolvedUrl)) continue;
                replacements.push({ full: match[0], resolvedUrl });
            }

            let result = cssText;
            for (const item of replacements) {
                try {
                    if (!cache.has(item.resolvedUrl)) {
                        cache.set(item.resolvedUrl, fetchAsDataUrl(item.resolvedUrl, fetchAdapter));
                    }
                    const dataUrl = await cache.get(item.resolvedUrl);
                    result = result.split(item.full).join(`url("${dataUrl}")`);
                } catch (_error) {
                    // 保留原始 URL；其它资源继续内联。
                }
            }
            return result;
        }

        async function inlineStylesheets(cloneDoc, fetchAdapter, resourceCache) {
            const originalLinks = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
            const clonedLinks = Array.from(cloneDoc.querySelectorAll('link[rel~="stylesheet"]'));

            await Promise.all(originalLinks.map(async (link, index) => {
                const cloned = clonedLinks[index];
                if (!cloned || !link.href) return;
                try {
                    const response = await fetchAdapter(link.href, { cache: 'force-cache' });
                    if (!response || response.status >= 400) return;
                    const cssText = await response.text();
                    const inlinedCss = await inlineCssUrls(cssText, link.href, fetchAdapter, resourceCache);
                    const style = cloneDoc.createElement('style');
                    if (link.media) style.setAttribute('media', link.media);
                    style.textContent = `/* ${link.href} */\n${inlinedCss}`;
                    cloned.replaceWith(style);
                } catch (_error) {
                    // 保留原 link。
                }
            }));

            const clonedStyles = Array.from(cloneDoc.querySelectorAll('style'));
            await Promise.all(clonedStyles.map(async (style) => {
                style.textContent = await inlineCssUrls(style.textContent || '', document.baseURI, fetchAdapter, resourceCache);
            }));
        }

        async function inlineImages(cloneDoc, fetchAdapter, resourceCache) {
            const originalImages = Array.from(document.images);
            const clonedImages = Array.from(cloneDoc.images);

            await Promise.all(originalImages.map(async (image, index) => {
                const cloned = clonedImages[index];
                if (!cloned) return;
                const imageUrl = image.currentSrc || image.src || image.getAttribute('src');
                if (!imageUrl || !isEmbeddableUrl(imageUrl) || imageUrl.startsWith('data:')) return;
                try {
                    if (!resourceCache.has(imageUrl)) {
                        resourceCache.set(imageUrl, fetchAsDataUrl(imageUrl, fetchAdapter));
                    }
                    const dataUrl = await resourceCache.get(imageUrl);
                    cloned.setAttribute('src', dataUrl);
                    cloned.removeAttribute('srcset');
                    cloned.removeAttribute('sizes');
                    cloned.removeAttribute('loading');
                } catch (_error) {
                    // 保留原图 URL。
                }
            }));

            cloneDoc.querySelectorAll('source[srcset]').forEach((source) => source.removeAttribute('srcset'));
        }

        async function inlineMediaPosters(cloneDoc, fetchAdapter, resourceCache) {
            const originalMedia = Array.from(document.querySelectorAll('video[poster]'));
            const clonedMedia = Array.from(cloneDoc.querySelectorAll('video[poster]'));

            await Promise.all(originalMedia.map(async (media, index) => {
                const cloned = clonedMedia[index];
                const posterUrl = media.poster || media.getAttribute('poster');
                if (!cloned || !posterUrl || !isEmbeddableUrl(posterUrl) || posterUrl.startsWith('data:')) return;
                try {
                    if (!resourceCache.has(posterUrl)) {
                        resourceCache.set(posterUrl, fetchAsDataUrl(posterUrl, fetchAdapter));
                    }
                    cloned.setAttribute('poster', await resourceCache.get(posterUrl));
                } catch (_error) {
                    // 保留原 poster。
                }
            }));
        }

        function freezeDynamicScripts(cloneDoc) {
            cloneDoc.querySelectorAll('script').forEach((script) => {
                script.setAttribute('type', 'application/x-bookmarks-manager-disabled-script');
                script.textContent = '';
                script.removeAttribute('src');
            });
        }

        function getDoctypeString() {
            const doctype = document.doctype;
            return doctype
                ? `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ''}${doctype.systemId ? ` "${doctype.systemId}"` : ''}>`
                : '<!DOCTYPE html>';
        }

        async function captureWithEmbeddedDom(startTime, docTitle) {
            const fetchAdapter = createSingleFileFetchAdapter();
            const cloneDoc = document.implementation.createHTMLDocument(docTitle || document.title || 'snapshot');
            cloneDoc.replaceChild(document.documentElement.cloneNode(true), cloneDoc.documentElement);
            const resourceCache = new Map();

            let base = cloneDoc.querySelector('base');
            if (!base) {
                base = cloneDoc.createElement('base');
                cloneDoc.head.insertBefore(base, cloneDoc.head.firstChild);
            }
            base.setAttribute('href', document.baseURI || location.href);

            await inlineStylesheets(cloneDoc, fetchAdapter, resourceCache);
            await inlineImages(cloneDoc, fetchAdapter, resourceCache);
            await inlineMediaPosters(cloneDoc, fetchAdapter, resourceCache);
            freezeDynamicScripts(cloneDoc);

            return {
                content: getDoctypeString() + '\n' + cloneDoc.documentElement.outerHTML,
                title: docTitle,
                method: 'dom-embedded',
                elapsed: Date.now() - startTime,
            };
        }

        function isSingleFileCaptureIncomplete(content) {
            const imageUrls = Array.from(document.images)
                .map((image) => image.currentSrc || image.src || image.getAttribute('src'))
                .filter((url) => url && !url.startsWith('data:'));
            if (imageUrls.length === 0) return false;

            const embeddedImageCount = (content.match(/data:image\//g) || []).length;
            if (embeddedImageCount >= imageUrls.length) return false;

            return imageUrls.some((url) => content.includes(url));
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
                        const singleFileCapture = await captureWithSingleFile(singleFileOptions, startTime, docTitle);
                        if (isSingleFileCaptureIncomplete(singleFileCapture.content)) {
                            return await captureWithEmbeddedDom(startTime, docTitle);
                        }
                        return singleFileCapture;
                    } catch (error) {
                        if (!allowNativeFallback) {
                            const message = error instanceof Error ? error.message : String(error || '未知错误');
                            throw new Error(`SingleFile 捕获失败：${message}`);
                        }
                    }
                }

                return await captureWithEmbeddedDom(startTime, docTitle);
            })(), timeoutMs, '页面处理超时，请刷新页面后重试');
        }
    })();
}
