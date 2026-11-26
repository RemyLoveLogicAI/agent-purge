// Native agent-purge console window host: WebView2 gives the console a window belonging to the application.
//
// Why not use Chrome/Edge --app mode: the window belongs to the browser, whose first launch can associate the system’s signed-in
// Microsoft account with the new profile (testing showed --disable-sync and --disable-features=ImplicitSignIn did not prevent it),
// making a local tool appear to request Microsoft account authorization. WebView2 has no browser first-run, account or sync,
// and the window icon and taskbar name belong to this application.
//
// Usage: agent-purge-window.exe <url> [--title T] [--width N] [--height N] [--data DIR] [--state FILE]
//   --data   WebView2 user data directory (browser state other than window size)
//   --state  Saved window position/size; if absent, center using --width/--height
#define UNICODE
#include <windows.h>
#include <shellapi.h>
#include <string>
#include <wrl/client.h>
#include "WebView2.h"

using Microsoft::WRL::ComPtr;

namespace {

HWND g_hwnd = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
std::wstring g_url = L"about:blank";
std::wstring g_title = L"agent-purge";
std::wstring g_dataFolder;
std::wstring g_stateFile;
int g_width = 1260;
int g_height = 860;

const wchar_t kClass[] = L"AgentPurgeWindow";

struct InstallationActivity {
	HANDLE mutex = CreateMutexW(nullptr, FALSE, L"agent-purge-desktop-active");
	~InstallationActivity() { if (mutex) CloseHandle(mutex); }
};

// High DPI: dynamically load Windows 10 SetProcessDpiAwarenessContext; MinGW user32 declarations vary by SDK.
// -4 is DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (the header may not define that name).
void EnableDpiAwareness() {
	typedef BOOL (WINAPI* SetContextFn)(HANDLE);
	HMODULE user32 = GetModuleHandleW(L"user32.dll");
	SetContextFn setContext = user32 ? (SetContextFn)GetProcAddress(user32, "SetProcessDpiAwarenessContext") : nullptr;
	if (setContext && setContext((HANDLE)(LONG_PTR)-4)) return;
	SetProcessDPIAware();
}

// MinGW gcc does not recognize MIDL __declspec(uuid), leaving __uuidof undefined, so define IIDs here;
// scripts/build-window-host.mjs checks WebView2.h MIDL_INTERFACE strings so missed IID updates fail the build.
const IID kEnvDoneIid = { 0x4e8a3389, 0xc9d8, 0x4bd2, { 0xb6, 0xb5, 0x12, 0x4f, 0xee, 0x6c, 0xc1, 0x4d } };
const IID kControllerDoneIid = { 0x6c4819f3, 0xc9b7, 0x4260, { 0x81, 0x27, 0xc9, 0xf5, 0xbd, 0xe7, 0xf6, 0x8c } };
const IID kController2Iid = { 0xc979903e, 0xd4ca, 0x4228, { 0x92, 0xeb, 0x47, 0xee, 0x3f, 0xa9, 0x6e, 0xab } };
const IID kScriptDoneIid = { 0x49511172, 0xcc67, 0x4bca, { 0x99, 0x23, 0x13, 0x71, 0x12, 0xf4, 0xc4, 0xcc } };

// Two checks before closing:
//   1. Ask the page about unsaved drafts (WebView2 does not run beforeunload automatically);
//   2. Whether to confirm: Node supplies text from the window-close settings (--confirm-close),
//      and the host displays a native dialog without depending on WebView2 script dialogs.
const wchar_t kDirtyScript[] = L"(window.__apDirty ? window.__apDirty() : false)";
const wchar_t kDirtyText[] = L"Unsaved settings or drafts. Close anyway?";
std::wstring g_confirmText;
bool g_closing = false;

/** COM callback implementing one interface; WebView2 queries only IUnknown and that interface. */
template <class T> class Once : public T {
	LONG refs = 1;
	const IID& iid;
public:
	explicit Once(const IID& id) : iid(id) {}
	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
		if (!ppv) return E_POINTER;
		if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, iid)) {
			*ppv = static_cast<T*>(this);
			AddRef();
			return S_OK;
		}
		*ppv = nullptr;
		return E_NOINTERFACE;
	}
	ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&refs); }
	ULONG STDMETHODCALLTYPE Release() override {
		LONG left = InterlockedDecrement(&refs);
		if (!left) delete this;
		return (ULONG)left;
	}
};

std::wstring ExeDir() {
	wchar_t path[32768];
	DWORD length = GetModuleFileNameW(nullptr, path, 32768);
	if (!length || length >= 32768) return L".";
	wchar_t* slash = wcsrchr(path, L'\\');
	if (slash) *slash = L'\0';
	return path;
}

void EnsureDir(const std::wstring& dir) {
	std::wstring current;
	for (size_t i = 0; i < dir.size(); i += 1) {
		current.push_back(dir[i]);
		bool boundary = dir[i] == L'\\' || dir[i] == L'/';
		if (!boundary || current.size() <= 3) continue;
		CreateDirectoryW(current.c_str(), nullptr);
	}
	CreateDirectoryW(dir.c_str(), nullptr);
}

/** Use a dark background with the system dark theme to prevent a white flash (the page injects data-theme). */
bool SystemUsesDarkTheme() {
	DWORD value = 1, size = sizeof(value);
	HKEY key = nullptr;
	if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", 0, KEY_READ, &key) != ERROR_SUCCESS) return false;
	LONG status = RegQueryValueExW(key, L"AppsUseLightTheme", nullptr, nullptr, (LPBYTE)&value, &size);
	RegCloseKey(key);
	return status == ERROR_SUCCESS && value == 0;
}

void SaveWindowState() {
	if (g_stateFile.empty() || !g_hwnd) return;
	WINDOWPLACEMENT placement = { sizeof(placement) };
	GetWindowPlacement(g_hwnd, &placement);
	RECT& rc = placement.rcNormalPosition;
	WCHAR line[128];
	wsprintfW(line, L"%ld %ld %ld %ld %d\n", rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top,
		placement.showCmd == SW_SHOWMAXIMIZED ? 1 : 0);
	HANDLE file = CreateFileW(g_stateFile.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
	if (file == INVALID_HANDLE_VALUE) return;
	DWORD written = 0;
	WriteFile(file, line, (DWORD)(wcslen(line) * sizeof(WCHAR)), &written, nullptr);
	CloseHandle(file);
}

/** Previous window position; center with default dimensions if unavailable. */
bool LoadWindowState(RECT& rc, bool& maximized) {
	maximized = false;
	if (g_stateFile.empty()) return false;
	HANDLE file = CreateFileW(g_stateFile.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
	if (file == INVALID_HANDLE_VALUE) return false;
	WCHAR buffer[128] = { 0 };
	DWORD read = 0;
	ReadFile(file, buffer, sizeof(buffer) - sizeof(WCHAR), &read, nullptr);
	CloseHandle(file);
	long x = 0, y = 0, w = 0, h = 0;
	int flag = 0;
	if (swscanf_s(buffer, L"%ld %ld %ld %ld %d", &x, &y, &w, &h, &flag) != 5) return false;
	if (w < 400 || h < 300) return false;
	// A changed or disconnected display can leave the saved position off-screen; ignore it and recenter.
	RECT saved = { x, y, x + w, y + h };
	if (MonitorFromRect(&saved, MONITOR_DEFAULTTONULL) == nullptr) return false;
	rc = { x, y, x + w, y + h };
	maximized = flag == 1;
	return true;
}

struct ControllerDone : Once<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler> {
	ControllerDone() : Once(kControllerDoneIid) {}
	HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Controller* controller) override {
		if (FAILED(result) || !controller) {
			MessageBoxW(g_hwnd, L"Could not create the WebView2 controller. Update Microsoft Edge WebView2 Runtime and try again.", L"agent-purge", MB_ICONERROR);
			return result;
		}
		g_controller = controller;
		controller->get_CoreWebView2(&g_webview);
		ComPtr<ICoreWebView2Controller2> modern;
		if (SUCCEEDED(controller->QueryInterface(kController2Iid, (void**)modern.GetAddressOf()))) {
			COREWEBVIEW2_COLOR color = SystemUsesDarkTheme()
				? COREWEBVIEW2_COLOR{ 0xFF, 0x14, 0x0F, 0x0B }   // #0B0F14
				: COREWEBVIEW2_COLOR{ 0xFF, 0xFA, 0xF8, 0xF7 };  // #F7F8FA
			modern->put_DefaultBackgroundColor(color);
		}
		RECT client;
		GetClientRect(g_hwnd, &client);
		controller->put_Bounds(client);
		g_webview->Navigate(g_url.c_str());
		return S_OK;
	}
};

struct EnvDone : Once<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler> {
	EnvDone() : Once(kEnvDoneIid) {}
	HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Environment* env) override {
		if (FAILED(result) || !env) {
			MessageBoxW(g_hwnd, L"Could not create the WebView2 environment. Install or repair Microsoft Edge WebView2 Runtime and try again.", L"agent-purge", MB_ICONERROR);
			return result;
		}
		env->CreateCoreWebView2Controller(g_hwnd, new ControllerDone());
		return S_OK;
	}
};

void CloseNow() {
	SaveWindowState();
	DestroyWindow(g_hwnd);
}

/** Ask about unsaved drafts, otherwise use --confirm-close to decide whether to confirm; cancel returns the close request. */
void AskThenClose(bool dirty) {
	const std::wstring text = dirty ? std::wstring(kDirtyText) : g_confirmText;
	if (text.empty() || MessageBoxW(g_hwnd, text.c_str(), L"agent-purge", MB_OKCANCEL | MB_ICONQUESTION) == IDOK) {
		CloseNow();
		return;
	}
	g_closing = false;
}

struct DirtyScriptDone : Once<ICoreWebView2ExecuteScriptCompletedHandler> {
	DirtyScriptDone() : Once(kScriptDoneIid) {}
	HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, LPCWSTR json) override {
		AskThenClose(SUCCEEDED(result) && json && std::wstring(json) == L"true");
		return S_OK;
	}
};

LRESULT CALLBACK Proc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
	switch (message) {
	case WM_SIZE:
		if (g_controller) {
			RECT client;
			GetClientRect(hwnd, &client);
			g_controller->put_Bounds(client);
		}
		return 0;
	case WM_CLOSE:
		// A second close click does not wait for the page, allowing closure if the page hangs.
		if (g_closing) { CloseNow(); return 0; }
		g_closing = true;
		if (g_webview && SUCCEEDED(g_webview->ExecuteScript(kDirtyScript, new DirtyScriptDone()))) return 0;
		g_closing = false;
		AskThenClose(false);
		return 0;
	case WM_DESTROY:
		if (g_controller) g_controller->Close();
		g_webview.Reset();
		g_controller.Reset();
		PostQuitMessage(0);
		return 0;
	}
	return DefWindowProcW(hwnd, message, wp, lp);
}

/** Load WebView2Loader.dll from the exe directory without linking an import library; SDK headers are a build-time dependency only. */
HRESULT CreateEnvironment() {
	typedef HRESULT (STDMETHODCALLTYPE *CreateEnvFn)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions*,
		ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);
	std::wstring loaderPath = ExeDir() + L"\\WebView2Loader.dll";
	HMODULE loader = LoadLibraryW(loaderPath.c_str());
	if (!loader) {
		MessageBoxW(nullptr, L"WebView2Loader.dll is missing. Reinstall agent-purge or use a browser window.", L"agent-purge", MB_ICONERROR);
		return HRESULT_FROM_WIN32(ERROR_MOD_NOT_FOUND);
	}
	CreateEnvFn createEnv = (CreateEnvFn)GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
	if (!createEnv) {
		MessageBoxW(nullptr, L"Incorrect WebView2Loader.dll version: CreateCoreWebView2EnvironmentWithOptions is missing.", L"agent-purge", MB_ICONERROR);
		return E_FAIL;
	}
	EnsureDir(g_dataFolder);
	return createEnv(nullptr, g_dataFolder.c_str(), nullptr, new EnvDone());
}

void ParseArgs(int argc, LPWSTR* argv) {
	for (int i = 1; i < argc; i += 1) {
		std::wstring arg = argv[i];
		auto next = [&](std::wstring& target) { if (i + 1 < argc) target = argv[++i]; };
		if (arg == L"--title") next(g_title);
		else if (arg == L"--data") next(g_dataFolder);
		else if (arg == L"--state") next(g_stateFile);
		else if (arg == L"--confirm-close") next(g_confirmText);
		else if (arg == L"--width") { std::wstring v; next(v); g_width = _wtoi(v.c_str()); }
		else if (arg == L"--height") { std::wstring v; next(v); g_height = _wtoi(v.c_str()); }
		else if (!arg.empty() && arg[0] != L'-') g_url = arg;
	}
	if (g_width < 400) g_width = 400;
	if (g_height < 300) g_height = 300;
}

} // namespace

int WINAPI WinMain(HINSTANCE instance, HINSTANCE, LPSTR, int show) {
	InstallationActivity activity;
	EnableDpiAwareness();
	int argc = 0;
	LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
	if (argv) { ParseArgs(argc, argv); LocalFree(argv); }
	if (g_dataFolder.empty()) g_dataFolder = ExeDir() + L"\\webview2-data";

	WNDCLASSEXW wc = { sizeof(wc) };
	wc.lpfnWndProc = Proc;
	wc.hInstance = instance;
	wc.lpszClassName = kClass;
	wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
	wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
	wc.hIconSm = wc.hIcon;
	wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
	if (!RegisterClassExW(&wc)) return 1;

	RECT rect = { 0, 0, g_width, g_height };
	bool maximized = false;
	if (!LoadWindowState(rect, maximized)) {
		RECT work{};
		SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
		int width = rect.right - rect.left, height = rect.bottom - rect.top;
		int x = work.left + ((work.right - work.left) - width) / 2;
		int y = work.top + ((work.bottom - work.top) - height) / 2;
		rect = { x, y, x + width, y + height };
	}
	g_hwnd = CreateWindowExW(0, kClass, g_title.c_str(), WS_OVERLAPPEDWINDOW,
		rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top, nullptr, nullptr, instance, nullptr);
	if (!g_hwnd) return 1;
	// Do not follow WinMain nCmdShow: the launcher starts Node with SW_HIDE, which would otherwise be inherited (issue #9).
	ShowWindow(g_hwnd, maximized ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL);
	SetForegroundWindow(g_hwnd);
	UpdateWindow(g_hwnd);

	if (FAILED(CreateEnvironment())) return 1;

	MSG message;
	while (GetMessageW(&message, nullptr, 0, 0) > 0) {
		TranslateMessage(&message);
		DispatchMessageW(&message);
	}
	return 0;
}
