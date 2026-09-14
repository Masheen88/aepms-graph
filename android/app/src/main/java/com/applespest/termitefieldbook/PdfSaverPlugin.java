package com.applespest.termitefieldbook;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
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
    public void savePdf(PluginCall call) {
        String filename = call.getString("filename", "termite-inspection.pdf");
        String contentType = call.getString("contentType", "application/pdf");
        String base64Data = call.getString("base64Data");

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("PDF data was empty.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(contentType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

        startActivityForResult(call, intent, "savePdfResult");
    }

    @ActivityCallback
    private void savePdfResult(PluginCall call, ActivityResult result) {
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
            call.reject("Android did not return a destination for the PDF.");
            return;
        }

        Uri destination = result.getData().getData();
        if (destination == null) {
            call.reject("Android returned an empty destination for the PDF.");
            return;
        }

        try {
            String base64Data = call.getString("base64Data");
            if (base64Data == null || base64Data.trim().isEmpty()) {
                call.reject("PDF data was unavailable after choosing a destination.");
                return;
            }

            int commaIndex = base64Data.indexOf(',');
            if (base64Data.startsWith("data:") && commaIndex >= 0) {
                base64Data = base64Data.substring(commaIndex + 1);
            }

            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) {
                    call.reject("Android could not open the selected PDF destination.");
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
            call.reject("The generated PDF data was invalid.", error);
        } catch (Exception error) {
            call.reject("Could not write the PDF to the selected destination.", error);
        }
    }
}
