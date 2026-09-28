import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const javaRoot = path.join(root, "android", "app", "src", "main", "java");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

const mainActivityPath = walk(javaRoot).find(
  (filePath) => path.basename(filePath) === "MainActivity.java",
);

if (!mainActivityPath) {
  throw new Error(
    "Could not find android/app/src/main/java/**/MainActivity.java. Run Capacitor's Android add step first.",
  );
}

let mainActivity = fs.readFileSync(mainActivityPath, "utf8");
const packageMatch = mainActivity.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/m);

if (!packageMatch) {
  throw new Error(`Could not determine the Java package from ${mainActivityPath}.`);
}

const javaPackage = packageMatch[1];
const pluginPath = path.join(path.dirname(mainActivityPath), "PdfSaverPlugin.java");

// Native file saver used by src/lib/nativeFileSave.js. Android's Storage Access
// Framework owns the picker, so the user chooses the exact filename/location
// and the app only receives write access to that selected URI.
const pluginSource = `package ${javaPackage};

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
`;

fs.writeFileSync(pluginPath, pluginSource, "utf8");

if (!mainActivity.includes("registerPlugin(PdfSaverPlugin.class);")) {
  const superOnCreatePattern = /super\.onCreate\(([^)]*)\);/;

  if (superOnCreatePattern.test(mainActivity)) {
    // Capacitor must know about the local plugin before BridgeActivity creates
    // its bridge, so register immediately before the existing super.onCreate.
    mainActivity = mainActivity.replace(
      superOnCreatePattern,
      "registerPlugin(PdfSaverPlugin.class);\n        super.onCreate($1);",
    );
  } else {
    // Fresh Capacitor projects often use an empty MainActivity. Add the minimal
    // lifecycle override while preserving any other class contents.
    if (!mainActivity.includes("import android.os.Bundle;")) {
      const packageLine = packageMatch[0];
      mainActivity = mainActivity.replace(
        packageLine,
        `${packageLine}\n\nimport android.os.Bundle;`,
      );
    }

    const classOpen = /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/;
    if (!classOpen.test(mainActivity)) {
      throw new Error("Could not patch MainActivity.java to register PdfSaverPlugin.");
    }

    mainActivity = mainActivity.replace(
      classOpen,
      (match) => `${match}\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        // Register before BridgeActivity builds the Capacitor bridge.\n        registerPlugin(PdfSaverPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n`,
    );
  }

  fs.writeFileSync(mainActivityPath, mainActivity, "utf8");
}

console.log(`Native Android file saver ready: ${path.relative(root, pluginPath)}`);
