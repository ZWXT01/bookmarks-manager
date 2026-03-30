import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const popupHtml = fs.readFileSync(path.join(process.cwd(), 'extension-new', 'popup.html'), 'utf8');
const popupScript = fs.readFileSync(path.join(process.cwd(), 'extension-new', 'popup.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(process.cwd(), 'extension-new', 'content.js'), 'utf8');

describe('extension popup shell', () => {
    it('declares the popup sections and stable selectors for runtime validation', () => {
        expect(popupHtml).toContain('data-testid="popup-root"');
        expect(popupHtml).toContain('data-testid="capture-panel"');
        expect(popupHtml).toContain('data-testid="action-panel"');
        expect(popupHtml).toContain('data-testid="utility-panel"');
        expect(popupHtml).toContain('id="settings-summary"');
        expect(popupHtml).toContain('id="selection-summary"');
        expect(popupHtml).toContain('id="status-title"');
        expect(popupHtml).toContain('id="status-message"');
    });

    it('keeps popup state management for settings summary, selection summary, and action busy states', () => {
        expect(popupScript).toContain('function updateSettingsSummary()');
        expect(popupScript).toContain('function updateSelectionSummary()');
        expect(popupScript).toContain('function setActionState(mode)');
        expect(popupScript).toContain("statusDiv.className = `alert ${type}`");
        expect(popupScript).toContain("settingsToggle.setAttribute('aria-expanded'");
    });

    it('keeps capture bridge guards for unsupported pages, target loss, and duplicate actions', () => {
        expect(popupScript).toContain('const CAPTURE_BRIDGE_TIMEOUT_MS = 1200;');
        expect(popupScript).toContain('const SNAPSHOT_CAPTURE_TIMEOUT_MS = 90000;');
        expect(popupScript).toContain('let activeActionMode = null;');
        expect(popupScript).toContain('function isCaptureSupportedUrl(rawUrl)');
        expect(popupScript).toContain('async function ensureCaptureBridge(tab)');
        expect(popupScript).toContain("showStatus(`${describeAction(activeActionMode)}，请等待当前操作完成`, 'loading');");
        expect(popupScript).toContain("showStatus(`无法开始存档: ${normalizeCaptureError(error, '页面连接失败')}`, 'error');");
    });

    it('keeps content-side ping, timeout, and in-flight capture guards', () => {
        expect(contentScript).toContain("const DEFAULT_CAPTURE_TIMEOUT_MS = 90000;");
        expect(contentScript).toContain("message.method === 'pingCapture'");
        expect(contentScript).toContain('let captureInFlight = false;');
        expect(contentScript).toContain("sendResponse({ success: false, error: '页面已有快照任务在执行，请稍候' });");
        expect(contentScript).toContain("'页面处理超时，请刷新页面后重试'");
    });
});
