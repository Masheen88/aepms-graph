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

// Native PDF saver used by src/lib/nativeFileSave.js. Android's Storage Access
// Framework owns the picker, so the user chooses the exact filename/location
// and the app only receives write access to that selected URI.
const pluginSource = `package ${javaPackage};

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

console.log(`Native PDF saver ready: ${path.relative(root, pluginPath)}`);
