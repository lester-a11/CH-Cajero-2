import { Capacitor, registerPlugin } from '@capacitor/core';
import { BarcodeBuffer } from './barcode-buffer.js';

const ScannerBridge = registerPlugin('ScannerBridge');
let requested = false;
let enabled = false;
let focusHooksInstalled = false;
const browserBuffer = new BarcodeBuffer({ maxGapMs: 100, minLength: 4, maxLength: 128 });

function isEditableFocused() {
  const active = document.activeElement;
  return Boolean(active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)));
}

async function applyScannerState() {
  const next = requested && !isEditableFocused();
  if (enabled === next) return;
  enabled = next;
  if (Capacitor.isNativePlatform()) {
    try { await ScannerBridge.setEnabled({ enabled }); }
    catch (error) { console.warn('Scanner bridge:', error); }
  }
}

function installFocusHooks() {
  if (focusHooksInstalled) return;
  focusHooksInstalled = true;
  document.addEventListener('focusin', () => { applyScannerState(); });
  document.addEventListener('focusout', () => setTimeout(applyScannerState, 80));
}

export function onBarcode(handler) {
  window.addEventListener('scanner:code', event => {
    const code = String(event.detail?.code || '').trim();
    if (code) handler(code);
  });
}

export async function setScannerEnabled(value) {
  requested = Boolean(value);
  installFocusHooks();
  await applyScannerState();
}

export async function getScannerStatus() {
  if (!Capacitor.isNativePlatform()) return { supported: false, connected: false, deviceName: '' };
  try {
    return await ScannerBridge.getStatus({});
  } catch (error) {
    console.warn('Scanner status:', error);
    return { supported: true, connected: false, deviceName: '' };
  }
}

export function installBrowserScanner(handler) {
  if (Capacitor.isNativePlatform()) return;
  window.addEventListener('keydown', event => {
    if (!enabled || isEditableFocused()) return;
    if (event.key === 'Enter') {
      const code = browserBuffer.finish(performance.now());
      if (code) handler(code);
      return;
    }
    if (event.key.length === 1) browserBuffer.push(event.key, performance.now());
  });
}
