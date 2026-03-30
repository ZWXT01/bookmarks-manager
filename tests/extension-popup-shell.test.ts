import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const popupHtml = fs.readFileSync(path.join(process.cwd(), 'extension-new', 'popup.html'), 'utf8');
const popupScript = fs.readFileSync(path.join(process.cwd(), 'extension-new', 'popup.js'), 'utf8');

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
});
