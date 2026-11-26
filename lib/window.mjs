// Native standalone desktop window launcher: prefer the bundled WebView2 host, otherwise use Chrome/Edge --app mode.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Prefer Chrome: on first launch Windows Edge associates the Microsoft account already signed in to the system with the new profile
// (testing showed --disable-sync and --disable-features=ImplicitSignIn do not prevent it); Chrome does not touch the Microsoft account.
const BROWSER_PATHS = [
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

/** Exclusive browser profile directory for the console window; see openAppWindow profileDir. */
export function windowProfileDir(home) {
	return join(home, "window-profile");
}

/** Record the browser owning window-profile: a profile cannot be reused after changing engines (Edge may retain the system Microsoft account). */
const PROFILE_MARKER = ".agent-purge-browser";

/**
 * Pair window-profile with the current browser.
 * Discard profiles from another engine (Edge → Chrome) or an older version to avoid handing an Edge profile containing the system account
 * to Chrome; rename also probes liveness: Windows refuses to rename an active profile, so leave it untouched.
 * @returns {boolean} Whether the old profile was actually discarded
 */
export function prepareWindowProfile(profileDir, browser, { rename = renameSync, remove = rmSync, read = readFileSync,
	write = writeFileSync, mkdir = mkdirSync } = {}) {
	if (!profileDir) return false;
	let owner = null;
	try { owner = read(join(profileDir, PROFILE_MARKER), "utf8").trim(); } catch { /* No marker means an older version or a different engine */ }
	let reset = false;
	if (owner !== browser && existsSync(profileDir)) {
		const stale = `${profileDir}.stale`;
		try {
			remove(stale, { recursive: true, force: true });
			rename(profileDir, stale);
			reset = true;
		} catch {
			return false;
		}
		try { remove(stale, { recursive: true, force: true }); } catch { /* Leave remaining files and retry cleanup on the next launch */ }
	}
	try {
		mkdir(profileDir, { recursive: true });
		write(join(profileDir, PROFILE_MARKER), browser);
	} catch { /* Failure to write marker does not prevent opening a window */ }
	return reset;
}

/**
 * Find locally installed Chromium-based browsers (Edge / Chrome).
 */
export function findChromiumAppBrowser() {
	if (process.platform !== "win32") return null;
	for (const p of BROWSER_PATHS) {
		if (existsSync(p)) return p;
	}
	return null;
}

/** WebView2 Runtime location: bundled with Windows 11; supplied through Edge updates on Windows 10. */
const WEBVIEW2_ROOTS = [
	"C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application",
	"C:\\Program Files\\Microsoft\\EdgeWebView\\Application",
];

/**
 * Whether an available WebView2 Runtime exists locally.
 * Check for msedgewebview2.exe in the directory rather than the registry: readdir is much cheaper than starting PowerShell.
 */
export function findWebView2Runtime() {
	if (process.platform !== "win32") return null;
	for (const root of WEBVIEW2_ROOTS) {
		let entries;
		try { entries = readdirSync(root); } catch { continue; }
		for (const entry of entries) {
			const exe = join(root, entry, "msedgewebview2.exe");
			if (existsSync(exe)) return exe;
		}
	}
	return null;
}

/** Native host readiness: executable, loader and runtime are all required. */
export function nativeWindowAvailable(nativeExe) {
	if (!nativeExe || !existsSync(nativeExe)) return false;
	if (!existsSync(join(dirname(nativeExe), "WebView2Loader.dll"))) return false;
	return Boolean(findWebView2Runtime());
}

/** Window host diagnostics: when a GUI process fails without a console or window, this file preserves clues (issue #20). */
export function nativeWindowLogPath(stateDir) {
	return join(stateDir, "window-error.log");
}

/**
 * Translate host exit codes into readable reasons.
 * 0xC0000135 means the loader cannot find a DLL: the host cannot start, so its own error handling cannot run.
 */
export function nativeExitHint(code) {
	if (code === 3221225781 || code === -1073741515) return "Missing runtime library (0xC0000135 STATUS_DLL_NOT_FOUND)";
	if (code === 3221225785 || code === -1073741511) return "Missing runtime entry point (0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND)";
	return "";
}

/**
 * Open a URL in a native app window (standalone, without address bar or tabs).
 *
 * Prefer bundled agent-purge-window.exe (WebView2): the window belongs to this app, without browser first-run, account,
 * or sync, and uses its own taskbar icon. If host or runtime is absent, fall back to Chrome/Edge --app mode; if neither exists,
 * use the system default browser.
 *
 * @param {string} url
 * @param {{ width?: number, height?: number, profileDir?: string, nativeExe?: string,
 *   spawnProcess?: typeof spawn, onError?: (error: Error) => void }} [opts]
 *
 * profileDir: exclusive profile for browser --app mode. Without it, Chromium passes the request to the user’s existing browser
 * process and exits immediately, invalidating the PID and preventing singleton focus. The native host does not need it to retain a PID,
 * but uses it for WebView2 data and saved window dimensions/position.
 */
export function openAppWindow(url, { width = 1260, height = 860, profileDir = null, nativeExe = null, confirmClose = "",
	nativeReady = null, nativeStartupTimeout = 2500, spawnProcess = spawn,
	onError = error => console.error(`[web] Could not open the browser automatically: ${error.message}; the service is still running. Open manually: ${url}`) } = {}) {
	const launch = (command, args) => {
		try {
			// The window launcher is a GUI process; windowsHide passes SW_HIDE to libuv/Windows,
			// creating the new Chromium window with WS_VISIBLE=0 (leaving a click-through white rectangle; issue #9).
			const child = spawnProcess(command, args, { detached: true, stdio: "ignore", windowsHide: false });
			child.once("error", onError);
			child.unref();
			return child;
		} catch (error) { onError(error); return null; }
	};
	// nativeReady is a test injection point: CI may lack WebView2 Runtime, so use it to exercise the native branch reliably.
	const useNative = nativeExe ? (nativeReady ?? nativeWindowAvailable(nativeExe)) : false;
	if (useNative) {
		const stateDir = profileDir ?? dirname(nativeExe);
		const child = launch(nativeExe, [
			url,
			"--title", "agent-purge · Prompt Console",
			"--data", join(stateDir, "webview2"),
			"--state", join(stateDir, "window-state.txt"),
			"--width", String(width),
			"--height", String(height),
			...(confirmClose ? ["--confirm-close", confirmClose] : []),
		]);
		const logFailure = detail => {
			try {
				mkdirSync(stateDir, { recursive: true });
				appendFileSync(nativeWindowLogPath(stateDir), `${new Date().toISOString()} agent-purge-window ${detail}\n`);
			} catch { /* Log write failure does not prevent opening the window */ }
		};
		// Wait briefly even for the short-lived launcher of a reused instance; otherwise process.exit prevents error listeners and logging.
		const ready = child ? new Promise(resolveReady => {
			let settled = false;
			const settle = ok => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolveReady(ok);
			};
			const timer = setTimeout(() => settle(true), nativeStartupTimeout);
			child.once("error", error => { logFailure(`spawn failed: ${error.message}`); settle(false); });
			child.once("exit", (code, signal) => {
				if (code === 0 && !signal) { settle(true); return; }
				const hint = nativeExitHint(code);
				const detail = signal ? `signal ${signal}` : `exit ${code} (0x${(code >>> 0).toString(16)})${hint ? ` ${hint}` : ""}`;
				logFailure(detail);
				onError(new Error(`Window host exited unexpectedly (${detail}); the service is still running. Open manually: ${url}`));
				settle(false);
			});
		}) : Promise.resolve(false);
		return { mode: child ? "app" : "manual", engine: "webview2", browser: "webview2", pid: child?.pid, ready };
	}
	const browser = findChromiumAppBrowser();
	if (browser) {
		// Discard profiles from other engines or older versions first: Edge profiles can contain the system Microsoft account and must not go to Chrome.
		prepareWindowProfile(profileDir, browser);
		// --app mode starts a standalone application window.
		// Suppress first-run prompts for an exclusive profile to avoid import-bookmarks/default-browser popups.
		// --disable-sync only disables sync, and does not stop Edge writing the system account into a new profile (tested with this flag and --disable-features
		// without success), so prefer Chrome locally and fall back to Edge only if Chrome is absent.
		const profileArgs = profileDir
			? [`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--hide-crash-restore-bubble", "--disable-sync"]
			: [];
		const child = launch(
			browser,
			[...profileArgs, `--app=${url}`, `--window-size=${width},${height}`],
		);
		return { mode: child ? "app" : "manual", engine: "chromium", browser, pid: child?.pid };
	}

	// Final fallback: open in the system default browser.
	let child;
	if (process.platform === "win32") {
		child = launch("cmd.exe", ["/d", "/c", "start", "", url]);
	} else if (process.platform === "darwin") {
		child = launch("open", [url]);
	} else {
		child = launch("xdg-open", [url]);
	}
	return { mode: child ? "browser" : "manual", browser: "default", pid: child?.pid };
}

/** If the native host fails at startup, open a browser without restarting the service; return the final window PID for singleton registration. */
export async function openAppWindowWithFallback(url, options = {}) {
	const opened = openAppWindow(url, options);
	if (opened.engine !== "webview2" || await opened.ready) return opened;
	return openAppWindow(url, {
		...options, nativeReady: false,
		// Use a separate subdirectory for browser fallback to avoid deleting native WebView2 data and window state.
		profileDir: options.profileDir ? join(options.profileDir, "browser-fallback") : null,
	});
}

// Bring an existing console window forward using Windows window enumeration:
// first select a top-level window belonging to our browser process, then fall back to title matching because the browser may restart;
// PID-only matching can miss it, and an existing window must never be duplicated (issue #14).
// Normally only the foreground process may set the foreground window. Explorer double-click launch has this
// permission, but command-line launch may not. AttachThreadInput connects input to the foreground thread to bypass the restriction.
const WINDOW_SCRIPT = (pid, profileDir) => {
	const quote = value => `'${String(value).replaceAll("'", "''")}'`;
	return `$sig = @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
[DllImport("user32.dll")] public static extern bool FlashWindow(IntPtr hWnd, bool invert);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int count);
'@
Add-Type -Namespace AgentPurge -Name Native -MemberDefinition $sig
$wanted = @(${Number.isInteger(pid) && pid > 0 ? pid : 0})
$profile = ${quote(profileDir ?? "")}
$windows = New-Object System.Collections.ArrayList
$collect = [AgentPurge.Native+EnumWindowsProc]{ param($handle, $state)
  if (-not [AgentPurge.Native]::IsWindowVisible($handle)) { return $true }
  $class = New-Object System.Text.StringBuilder 256
  [void][AgentPurge.Native]::GetClassName($handle, $class, 256)
  # AgentPurgeWindow is the bundled WebView2 host; Chrome_WidgetWin_1 is browser --app mode.
  if ($class.ToString() -ne 'Chrome_WidgetWin_1' -and $class.ToString() -ne 'AgentPurgeWindow') { return $true }
  $text = New-Object System.Text.StringBuilder 512
  [void][AgentPurge.Native]::GetWindowText($handle, $text, 512)
  [uint32]$owner = 0
  [void][AgentPurge.Native]::GetWindowThreadProcessId($handle, [ref]$owner)
  [void]$windows.Add([pscustomobject]@{ hwnd = [Int64]$handle; title = $text.ToString(); pid = $owner })
  return $true
}
[void][AgentPurge.Native]::EnumWindows($collect, [IntPtr]::Zero)
$pick = $null
foreach ($window in $windows) { if ($wanted -contains $window.pid) { $pick = $window; break } }
if (-not $pick -and $profile) {
  try {
    $wanted += @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" -OperationTimeoutSec 3 -ErrorAction Stop |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) -and $_.CommandLine -notlike '*--type=*' } |
      ForEach-Object { $_.ProcessId })
    foreach ($window in $windows) { if ($wanted -contains $window.pid) { $pick = $window; break } }
  } catch {}
}
if (-not $pick) { foreach ($window in $windows) { if ($window.title -like 'agent-purge · Prompt Console*' -or $window.title -like ('agent-purge · ' + [string]::Concat([char]0x63d0,[char]0x793a,[char]0x8bcd,[char]0x63a7,[char]0x5236,[char]0x53f0) + '*')) { $pick = $window; break } } }
if (-not $pick) { 'AGENT_PURGE_WINDOW_NOT_FOUND'; exit 0 }
$handle = [IntPtr]$pick.hwnd
[void][AgentPurge.Native]::ShowWindow($handle, 9)
if ([AgentPurge.Native]::GetForegroundWindow() -ne $handle) {
  [uint32]$owner = 0
  $foreground = [AgentPurge.Native]::GetWindowThreadProcessId([AgentPurge.Native]::GetForegroundWindow(), [ref]$owner)
  $mine = [AgentPurge.Native]::GetCurrentThreadId()
  [void][AgentPurge.Native]::AttachThreadInput($mine, $foreground, $true)
  [void][AgentPurge.Native]::BringWindowToTop($handle)
  [void][AgentPurge.Native]::SetForegroundWindow($handle)
  [void][AgentPurge.Native]::AttachThreadInput($mine, $foreground, $false)
}
if ([AgentPurge.Native]::GetForegroundWindow() -ne $handle) {
  # If focus still failed, minimize then restore, equivalent to the user restoring the window.
  [void][AgentPurge.Native]::ShowWindow($handle, 6)
  Start-Sleep -Milliseconds 120
  [void][AgentPurge.Native]::ShowWindow($handle, 9)
  [void][AgentPurge.Native]::SetForegroundWindow($handle)
}
if ([AgentPurge.Native]::GetForegroundWindow() -ne $handle) {
  # Last resort: SwitchToThisWindow uses the shell switch channel and is less restrictive than SetForegroundWindow.
  [AgentPurge.Native]::SwitchToThisWindow($handle, $true)
  Start-Sleep -Milliseconds 150
}
if ([AgentPurge.Native]::GetForegroundWindow() -ne $handle) {
  # If the system still denies foreground focus (for example, from a terminal), flash the taskbar so the user can find the window.
  for ($i = 0; $i -lt 3; $i++) {
    [void][AgentPurge.Native]::FlashWindow($handle, $true)
    Start-Sleep -Milliseconds 180
    [void][AgentPurge.Native]::FlashWindow($handle, $false)
    Start-Sleep -Milliseconds 120
  }
}
if ([AgentPurge.Native]::GetForegroundWindow() -eq $handle) { 'AGENT_PURGE_WINDOW_FOCUSED' } else { 'AGENT_PURGE_WINDOW_UNFOCUSED' }
`;
};

/**
 * Find the console window and try to bring it forward.
 * found=false means the window is gone (closed or browser crashed); the caller may open another.
 * found=true and focused=false means the window exists but the system denied focus; never open a duplicate.
 * @param {{ pid?: number, profileDir?: string }} target
 * @param {{ platform?: string, run?: typeof execFileSync }} [opts]
 */
export function focusConsoleWindow({ pid = 0, profileDir = null } = {}, { platform = process.platform, run = execFileSync } = {}) {
	try {
		if (platform === "win32") {
			const pwsh = join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe");
			const powershell = existsSync(pwsh) ? pwsh : join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
				"System32", "WindowsPowerShell", "v1.0", "powershell.exe");
			const env = { ...process.env };
			for (const key of Object.keys(env)) if (["PSMODULEPATH", "PSHOME"].includes(key.toUpperCase())) delete env[key];
			const output = run(
				powershell,
				["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WINDOW_SCRIPT(pid, profileDir)],
				{ encoding: "utf8", windowsHide: true, timeout: 20000, env },
			);
			const lines = String(output).trim().split(/\r?\n/);
			const verdict = lines[lines.length - 1]?.trim();
			if (verdict === "AGENT_PURGE_WINDOW_FOCUSED") return { found: true, focused: true };
			if (verdict === "AGENT_PURGE_WINDOW_UNFOCUSED") return { found: true, focused: false };
			return { found: false, focused: false };
		}
		if (platform === "darwin" && Number.isInteger(pid) && pid > 0) {
			run("osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`], { encoding: "utf8", timeout: 15000 });
			return { found: true, focused: true };
		}
	} catch {
		return { found: false, focused: false };
	}
	return { found: false, focused: false };
}
