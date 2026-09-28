package com.applespest.termitefieldbook;

import android.app.Activity;
import android.content.Intent;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "PdfSaver")
public class PdfSaverPlugin extends Plugin {
    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename", "termite-fieldbook-export");
        String contentType = call.getString("contentType", "application/octet-stream");
        String base64Data = call.getString("base64Data");

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("File data was empty.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(contentType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

        startActivityForResult(call, intent, "saveFileResult");
    }

    @PluginMethod
    public void saveFileToDownloads(PluginCall call) {
        String filename = call.getString("filename", "termite-fieldbook-export");
        String contentType = call.getString("contentType", "application/octet-stream");
        String base64Data = call.getString("base64Data");

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("File data was empty.");
            return;
        }

        // MediaStore.Downloads is available from Android 10 onward and does not
        // require broad external-storage permission for files created by this app.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Direct Downloads saving requires Android 10 or newer.");
            return;
        }

        Uri destination = null;
        try {
            int commaIndex = base64Data.indexOf(',');
            if (base64Data.startsWith("data:") && commaIndex >= 0) {
                base64Data = base64Data.substring(commaIndex + 1);
            }
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, contentType);
            values.put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + "/Termite Fieldbook"
            );
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);

            destination = getContext().getContentResolver().insert(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                values
            );
            if (destination == null) {
                call.reject("Android could not create the file in Downloads.");
                return;
            }

            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) {
                    throw new IllegalStateException("Android could not open the Downloads destination.");
                }
                output.write(bytes);
                output.flush();
            }

            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContext().getContentResolver().update(destination, values, null, null);

            JSObject response = new JSObject();
            response.put("saved", true);
            response.put("cancelled", false);
            response.put("uri", destination.toString());
            response.put("folder", "Downloads/Termite Fieldbook");
            call.resolve(response);
        } catch (IllegalArgumentException error) {
            if (destination != null) getContext().getContentResolver().delete(destination, null, null);
            call.reject("The generated file data was invalid.", error);
        } catch (Exception error) {
            if (destination != null) getContext().getContentResolver().delete(destination, null, null);
            call.reject("Could not write the file to Downloads.", error);
        }
    }

    // Compatibility aliases for v1.5.3 web bundles that still call the PDF-specific names.
    @PluginMethod
    public void savePdf(PluginCall call) {
        saveFile(call);
    }

    @PluginMethod
    public void savePdfToDownloads(PluginCall call) {
        saveFileToDownloads(call);
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject cancelled = new JSObject();
            cancelled.put("saved", false);
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Android did not return a destination for the file.");
            return;
        }

        Uri destination = result.getData().getData();
        if (destination == null) {
            call.reject("Android returned an empty destination for the file.");
            return;
        }

        try {
            String base64Data = call.getString("base64Data");
            if (base64Data == null || base64Data.trim().isEmpty()) {
                call.reject("File data was unavailable after choosing a destination.");
                return;
            }

            int commaIndex = base64Data.indexOf(',');
            if (base64Data.startsWith("data:") && commaIndex >= 0) {
                base64Data = base64Data.substring(commaIndex + 1);
            }

            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) {
                    call.reject("Android could not open the selected file destination.");
                    return;
                }

                output.write(bytes);
                output.flush();
            }

            JSObject response = new JSObject();
            response.put("saved", true);
            response.put("cancelled", false);
            response.put("uri", destination.toString());
            call.resolve(response);
        } catch (IllegalArgumentException error) {
            call.reject("The generated file data was invalid.", error);
        } catch (Exception error) {
            call.reject("Could not write the file to the selected destination.", error);
        }
    }
}
