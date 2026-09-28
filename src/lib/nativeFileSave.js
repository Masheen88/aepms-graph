import { Capacitor, registerPlugin } from "@capacitor/core";

// The native plugin is generated locally by scripts/install-android-pdf-saver.mjs.
// The historical plugin name stays PdfSaver so existing Android projects continue
// to work, but the bridge now saves any exportable file type, not only PDFs.
const NativeFileSaver = registerPlugin("PdfSaver");

/**
 * Returns true only inside the installed Capacitor Android application.
 */
export function canUseNativeAndroidFileSave() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/**
 * Convert arbitrary bytes into bridge-safe base64 without spreading the complete
 * Uint8Array into one function call. PDF and JSON backup files can both become
 * large enough to exceed the JavaScript engine's argument limit.
 */
function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function textToBytes(text) {
  return new TextEncoder().encode(String(text));
}

/**
 * Open Android's system Create document picker and write arbitrary bytes to the
 * selected content URI.
 */
export async function saveFileWithNativeAndroidPicker(bytes, filename, contentType) {
  return NativeFileSaver.saveFile({
    filename,
    contentType,
    base64Data: bytesToBase64(bytes),
  });
}

/**
 * Save arbitrary bytes directly into Android's public Downloads collection.
 */
export async function saveFileToAndroidDownloads(bytes, filename, contentType) {
  return NativeFileSaver.saveFileToDownloads({
    filename,
    contentType,
    base64Data: bytesToBase64(bytes),
  });
}

export function saveTextWithNativeAndroidPicker(text, filename, contentType = "application/json") {
  return saveFileWithNativeAndroidPicker(textToBytes(text), filename, contentType);
}

export function saveTextToAndroidDownloads(text, filename, contentType = "application/json") {
  return saveFileToAndroidDownloads(textToBytes(text), filename, contentType);
}

// PDF-specific names remain as small wrappers so existing call sites and native
// projects stay backward compatible.
export function savePdfWithNativeAndroidPicker(bytes, filename) {
  return saveFileWithNativeAndroidPicker(bytes, filename, "application/pdf");
}

export function savePdfToAndroidDownloads(bytes, filename) {
  return saveFileToAndroidDownloads(bytes, filename, "application/pdf");
}
