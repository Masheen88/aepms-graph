import { Capacitor, registerPlugin } from "@capacitor/core";

// This plugin is implemented locally in the Android project by
// scripts/install-android-pdf-saver.mjs. Keeping the native bridge tiny lets the
// web app use Android's real ACTION_CREATE_DOCUMENT picker without adding a
// third-party storage abstraction around the PDF bytes.
const PdfSaver = registerPlugin("PdfSaver");

/**
 * Returns true only inside the installed Capacitor Android application.
 */
export function canUseNativeAndroidFileSave() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/**
 * Convert PDF bytes into bridge-safe base64 without spreading the complete
 * Uint8Array into one function call. Large inspection PDFs can easily exceed
 * the JavaScript engine's argument limit when String.fromCharCode(...bytes) is
 * used on the whole document at once.
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

/**
 * Open Android's system "Create document" picker and write the generated PDF
 * to the exact content URI selected by the inspector.
 */
export async function savePdfWithNativeAndroidPicker(bytes, filename) {
  return PdfSaver.savePdf({
    filename,
    contentType: "application/pdf",
    base64Data: bytesToBase64(bytes),
  });
}
