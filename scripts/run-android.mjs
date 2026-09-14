import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const isWindows = process.platform === "win32";

function line() {
  console.log("\n" + "=".repeat(60));
}

function heading(text) {
  line();
  console.log(text);
  console.log("=".repeat(60) + "\n");
}

function run(args, options = {}) {
  heading(`> pnpm ${args.join(" ")}`);

  // .cmd files are not standalone executables on Windows. Invoke pnpm through
  // the user's command processor explicitly instead of spawn(..., { shell:true }),
  // which avoids Node's shell-argument deprecation warning for these static commands.
  const executable = isWindows ? process.env.ComSpec || "cmd.exe" : "pnpm";
  const commandArgs = isWindows
    ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: false,
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function runNode(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed with exit code ${result.status}.`);
  }
}

function parseJavaMajor(versionOutput) {
  // Java 9+ reports versions like `21.0.6`; older releases may use `1.8.0_...`.
  const match = String(versionOutput || "").match(/version\s+["']([^"']+)["']/i);
  if (!match) return null;

  const rawVersion = match[1];
  const parts = rawVersion.split(/[._-]/);
  const first = Number.parseInt(parts[0], 10);
  if (!Number.isFinite(first)) return null;

  if (first === 1 && parts.length > 1) {
    const legacyMajor = Number.parseInt(parts[1], 10);
    return Number.isFinite(legacyMajor) ? legacyMajor : null;
  }

  return first;
}

function inspectJavaHome(javaHome) {
  if (!javaHome) return null;

  const javaExecutable = path.join(javaHome, "bin", isWindows ? "java.exe" : "java");
  if (!fs.existsSync(javaExecutable)) return null;

  const result = spawnSync(javaExecutable, ["-version"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    shell: false,
  });

  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const major = parseJavaMajor(output);

  return {
    home: javaHome,
    executable: javaExecutable,
    major,
    output,
  };
}

function configureJava() {
  // Capacitor 8's Android build is compiled with Java source level 21. Do not
  // trust an existing JAVA_HOME blindly: an older JDK can make the runner print
  // "Java 21" while Gradle is actually using Java 17 and then fail with
  // `invalid source release: 21`. Validate every candidate before selecting it.
  const candidateHomes = [];

  if (isWindows) {
    // Android Studio's bundled JBR is the safest Windows default because it is
    // maintained alongside the installed Android toolchain. Prefer it even when
    // the shell has a stale JAVA_HOME pointing at an older standalone JDK.
    candidateHomes.push("C:\\Program Files\\Android\\Android Studio\\jbr");
  } else if (process.platform === "darwin") {
    candidateHomes.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  } else {
    candidateHomes.push("/opt/android-studio/jbr");
  }

  if (process.env.JAVA_HOME) {
    candidateHomes.push(process.env.JAVA_HOME);
  }

  // Remove duplicate paths while preserving preference order.
  const uniqueHomes = [...new Set(candidateHomes.filter(Boolean))];
  const inspected = uniqueHomes.map(inspectJavaHome).filter(Boolean);
  const selected = inspected.find((candidate) => candidate.major >= 21);

  if (!selected) {
    const details = inspected.length
      ? inspected
          .map((candidate) => `- ${candidate.home}: Java ${candidate.major ?? "unknown"}`)
          .join("\n")
      : "- No usable Java installation was found in Android Studio JBR or JAVA_HOME.";

    throw new Error(
      [
        "Java 21 or newer is required for this Capacitor Android build.",
        "",
        "Checked Java installations:",
        details,
        "",
        isWindows
          ? "Install/update Android Studio so C:\\Program Files\\Android\\Android Studio\\jbr contains Java 21+, or point JAVA_HOME at a JDK 21+ installation."
          : "Install Android Studio/JDK 21+ or point JAVA_HOME at a JDK 21+ installation.",
      ].join("\n"),
    );
  }

  process.env.JAVA_HOME = selected.home;
  const separator = isWindows ? ";" : ":";
  const javaBin = path.join(selected.home, "bin");

  // Put the selected Java first so Gradle and child pnpm/cap processes cannot
  // accidentally resolve an older java.exe earlier on PATH.
  process.env.PATH = `${javaBin}${separator}${process.env.PATH || ""}`;

  console.log(`Using Java ${selected.major} / Android toolchain from:\n`);
  console.log(selected.home);
}

try {
  heading("Apple's Termite Fieldbook - Android Runner");

  heading("STEP 1: Checking Java / Android toolchain");
  configureJava();

  heading("STEP 2: Checking Capacitor configuration");
  const capacitorConfig = path.join(root, "capacitor.config.json");
  if (!fs.existsSync(capacitorConfig)) {
    throw new Error(
      "capacitor.config.json is missing. Keep the existing config from your Android project so its appId/package identity and saved device data remain unchanged.",
    );
  }
  console.log("Found capacitor.config.json");

  heading("STEP 3: Checking Android native project");
  const androidRoot = path.join(root, "android");
  if (!fs.existsSync(androidRoot)) {
    console.log("Android native project is missing. Creating it from the existing Capacitor config...");
    run(["exec", "cap", "add", "android"]);
  } else {
    console.log("Android native project already exists.");
  }

  heading("STEP 4: Installing native Android PDF saver");
  runNode(path.join(root, "scripts", "install-android-pdf-saver.mjs"));

  heading("STEP 5: Building Vite application");
  run(["exec", "vite", "build"]);

  heading("STEP 6: Checking web build output");
  const webBuild = path.join(root, "dist", "client");
  if (!fs.existsSync(webBuild)) {
    throw new Error(`Vite build output was not found at ${webBuild}.`);
  }
  console.log("Web build is ready:\n");
  console.log(webBuild);

  heading("STEP 7: Syncing Capacitor Android project");
  run(["exec", "cap", "sync", "android"]);

  heading("STEP 8: Selecting Android device and launching app");
  console.log("Select the Android device using the arrow keys.");
  console.log("Press Enter to build, install, and launch.\n");
  run(["exec", "cap", "run", "android", "--no-sync"]);

  heading("Android deployment completed successfully.");
  console.log("Debug APK:\n");
  console.log(path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"));
} catch (error) {
  console.error("\n" + (error?.message || error));
  process.exitCode = 1;
}
