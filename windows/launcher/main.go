//go:build windows

// Fleabook's Windows launcher.
//
// The app itself is the same SvelteKit/adapter-node server that runs under
// Docker on Linux. This does the work Docker Compose does there — set the
// handful of environment variables the server cannot infer, start Node, wait
// for the port — and then puts the UI in a native window instead of a browser
// tab. Nothing app-specific lives here: if it needs a code change, it belongs
// in the server, not the launcher.
//
// Built for the GUI subsystem (-H=windowsgui), so there is no console. Anything
// the user must read goes to a message box; everything else goes to the log file
// under %LOCALAPPDATA%\Fleabook\logs. A println here goes nowhere — use logf.
package main

import (
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
)

const appName = "Fleabook"

// Pinned, not chosen dynamically.
//
// SvelteKit's CSRF check compares the caller's Origin against the origin the
// server derives for itself, and adapter-node assumes https when there is no
// proxy telling it otherwise. The build works around that with an explicit
// trusted-origin list in vite.config.ts — which names this port. Picking a free
// port at runtime would silently land outside that list and 403 every photo
// upload, so a busy port is reported as an error instead.
const port = "5180"

const startupTimeout = 90 * time.Second

// The icon group goversioninfo embeds under IDI_APPLICATION (see
// windows/resources/versioninfo.json). go-webview2 only takes the correct
// LoadImageW path when IconId is non-zero — its zero-value branch passes the
// arguments in the wrong order and silently ends up with no icon at all — so
// this is set explicitly even though it names the default resource.
const appIconID = 32512

func main() {
	// WebView2's message loop must own the thread it was created on.
	runtime.LockOSThread()

	if err := run(); err != nil {
		logf("fatal: %v", err)
		alert(fmt.Sprintf("Fleabook could not start.\n\n%v", err))
		os.Exit(1)
	}
}

func run() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locating the application folder: %w", err)
	}
	root := filepath.Dir(exe)

	node := filepath.Join(root, "node", "node.exe")
	server := filepath.Join(root, "build", "index.js")

	for _, required := range []string{node, server} {
		if _, err := os.Stat(required); err != nil {
			return fmt.Errorf("%s is missing — the installation looks incomplete, try installing Fleabook again", required)
		}
	}

	appRoot, err := resolveAppRoot(root)
	if err != nil {
		return err
	}
	dataDir, err := subdir(appRoot, "data")
	if err != nil {
		return err
	}
	if err := startLogging(appRoot); err != nil {
		return err
	}
	logf("starting: root=%s data=%s", root, dataDir)
	restoreAgentBinary(root)

	if occupied(port) {
		return fmt.Errorf(
			"port %s is already in use.\n\nAnother copy of Fleabook is probably already running — "+
				"look for its window before starting a second one.", port)
	}

	cmd := exec.Command(node, server)
	cmd.Dir = root
	if logSink != nil {
		// Assigned only when non-nil: a typed-nil *os.File in an io.Writer is
		// not a nil interface, and os/exec would try to write to it.
		cmd.Stdout = logSink
		cmd.Stderr = logSink
	}
	cmd.Env = append(os.Environ(),
		"NODE_ENV=production",
		"DATA_DIR="+dataDir,
		"HOST=127.0.0.1",
		"PORT="+port,
		// adapter-node defaults to 512K, which rejects a single phone photo —
		// they run 3-12MB each. Docker Compose sets the same value for the same
		// reason; both copies matter, because neither path reads the other's.
		"BODY_SIZE_LIMIT=128M",
		// The agent SDK ships claude.exe as a pinned dependency inside the app
		// folder, and its self-updater is not aware it lives there. Updating
		// renames the running binary to claude.exe.old.<epoch> before writing the
		// replacement; when that second step does not land, the SDK's resolver
		// finds nothing and every run fails with "Native CLI binary for win32-x64
		// not found" -- pointing the user at an npm reinstall they cannot perform,
		// on an install that has no npm. The version here is the one the build
		// pinned and tested, so updating it in place was never wanted.
		"DISABLE_AUTOUPDATER=1",
	)
	// No console to inherit, and no console for Node to pop up either.
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("starting the server: %w", err)
	}

	// Tie Node's lifetime to this process. Without it, closing the window
	// orphans node.exe, which keeps holding the port and makes the next launch
	// fail with a confusing "already in use".
	if err := superviseChild(cmd.Process.Pid); err != nil {
		logf("warning: could not put the server in a job object: %v", err)
	}

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	defer func() {
		_ = cmd.Process.Kill()
		<-exited
		logf("stopped")
	}()

	target := "http://127.0.0.1:" + port

	w := newWindow(appRoot)
	if w == nil {
		// The installer bootstraps the WebView2 runtime, so this is the case
		// where someone copied the folder from an installed machine. Falling
		// back to the browser keeps them working; the modal is what gives them
		// a way to stop the server afterwards, since there is no console.
		logf("webview2 unavailable, falling back to the default browser")
		openExternal(target)
		alert(fmt.Sprintf(
			"Fleabook could not open its own window, because the Microsoft Edge WebView2 "+
				"Runtime is not installed.\n\nIt has opened in your browser instead, at %s\n\n"+
				"Click OK to stop Fleabook.", target))
		return nil
	}
	defer w.Destroy()

	// Must be bound before the first navigation: Bind works by injecting a
	// script at document creation, which has already happened for a loaded page.
	if err := w.Bind("fleabookOpenExternal", openExternal); err != nil {
		logf("warning: could not bind the external-link handler: %v", err)
	} else {
		w.Init(externalLinkScript)
	}

	w.SetSize(minWidth, minHeight, webview2.HintMin)
	w.SetHtml(splashHTML)

	go func() {
		select {
		case err := <-exited:
			logf("server stopped during startup: %v", err)
			w.Dispatch(func() { w.SetHtml(errorHTML("The server stopped while starting up.")) })
		case <-ready(port, exited):
			logf("server is up on %s", target)
			w.Dispatch(func() { w.Navigate(target) })
		case <-time.After(startupTimeout):
			logf("server did not start within %s", startupTimeout)
			w.Dispatch(func() {
				w.SetHtml(errorHTML(fmt.Sprintf("The server did not finish starting within %s.", startupTimeout)))
			})
		}
	}()

	w.Run()
	return nil
}

// newWindow returns nil when the WebView2 runtime is missing or refuses to
// embed, which is the one failure the caller has a useful answer for.
func newWindow(appRoot string) webview2.WebView {
	// Give WebView2 its own folder rather than letting it default to one beside
	// the executable, which is read-only for a machine-wide install and would
	// scatter a cache into Program Files for a per-user one.
	dataPath, err := subdir(appRoot, "webview")
	if err != nil {
		logf("warning: could not create the webview cache folder: %v", err)
		dataPath = ""
	}

	width, height := windowSize()
	logf("opening a %dx%d window", width, height)

	return webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  appName,
			Width:  uint(width),
			Height: uint(height),
			IconId: appIconID,
			Center: true,
		},
	})
}

const (
	preferredWidth  = 1280
	preferredHeight = 860
	minWidth        = 820
	minHeight       = 560
)

// windowSize never returns anything larger than the screen. go-webview2 centres
// the window with `(screenWidth - width) / 2` on unsigned values, so a window
// even one pixel taller than the display underflows to an enormous coordinate
// and opens somewhere the user cannot reach — and 860px of preferred height
// does not fit a 1366x768 laptop.
func windowSize() (int, int) {
	width, height := preferredWidth, preferredHeight

	screenWidth, screenHeight := screenSize()
	if screenWidth <= 0 || screenHeight <= 0 {
		// GetSystemMetrics should not fail, but guessing large here is the one
		// mistake that puts the window off-screen. Guess small instead.
		return minWidth, minHeight
	}

	// Leave a margin so the window reads as a window rather than as something
	// that failed to maximise.
	if roomy := screenWidth - 120; width > roomy {
		width = roomy
	}
	if roomy := screenHeight - 120; height > roomy {
		height = roomy
	}
	if width < minWidth {
		width = minWidth
	}
	if height < minHeight {
		height = minHeight
	}

	// Last, and unconditionally: the minimums above may have pushed it back over
	// the screen size, and this is the bound that must hold.
	if width > screenWidth {
		width = screenWidth
	}
	if height > screenHeight {
		height = screenHeight
	}
	return width, height
}

func screenSize() (int, int) {
	width, _, _ := procGetSystemMetrics.Call(smCXScreen)
	height, _, _ := procGetSystemMetrics.Call(smCYScreen)
	return int(int32(width)), int(int32(height))
}

// WebView2 has no browser chrome, so a target="_blank" link would otherwise
// open a second chromeless window with no address bar and no way back. Hand
// anything leaving the app's own origin to the real browser instead.
const externalLinkScript = `
(function () {
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.href;
    if (!href) return;
    var external;
    try {
      external = new URL(href, location.href).origin !== location.origin;
    } catch (err) {
      return;
    }
    if (!external && a.target !== '_blank') return;
    if (!external) return;
    e.preventDefault();
    window.fleabookOpenExternal(href);
  }, true);
})();
`

// Bound into the page, so treat the argument as untrusted: rundll32's
// FileProtocolHandler will happily act on schemes that are not web links.
func openExternal(raw string) {
	u, err := url.Parse(raw)
	if err != nil {
		logf("refusing to open an unparseable link: %v", err)
		return
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		logf("refusing to open a %q link", u.Scheme)
		return
	}
	if err := exec.Command("rundll32", "url.dll,FileProtocolHandler", u.String()).Start(); err != nil {
		logf("could not open %s: %v", u.Redacted(), err)
	}
}

// Listings, photos, and the meetup note live outside the program folder so an
// install under Program Files — which is read-only for normal users — still
// works, and so replacing the app folder on upgrade never touches user data.
// The layout under here (data/, logs/, webview/) is also what the uninstaller
// offers to remove, so keep them together.
// Put the agent SDK's claude.exe back if its self-updater left without it.
//
// The updater renames the running binary to claude.exe.old.<epoch> before
// writing a replacement — the usual Windows dance, since an executing file
// cannot be overwritten. When the second half does not land, the folder is left
// holding only the .old copy, and every listing then fails with "Native CLI
// binary for win32-x64 not found": an error that names an npm reinstall, on a
// machine with no npm, for a package the user never installed. DISABLE_AUTOUPDATER
// (see the environment above) stops this happening again, but it does nothing for
// a copy already in that state, and those exist in the wild.
//
// Deliberately narrow: it acts only when claude.exe is absent and exactly one
// candidate is present. Two candidates means an update history this cannot
// reason about, and guessing which is the real binary is worse than reporting
// the problem. Failure is never fatal — the server may still work via an API
// key, which needs no CLI at all.
func restoreAgentBinary(root string) {
	dir := filepath.Join(root, "node_modules", "@anthropic-ai", "claude-agent-sdk-win32-x64")
	binary := filepath.Join(dir, "claude.exe")

	if _, err := os.Stat(binary); err == nil {
		return
	}

	candidates, err := filepath.Glob(filepath.Join(dir, "claude.exe.old.*"))
	if err != nil || len(candidates) != 1 {
		if len(candidates) > 1 {
			logf("claude.exe is missing and %d backups exist; leaving them alone", len(candidates))
		}
		return
	}

	if err := os.Rename(candidates[0], binary); err != nil {
		logf("could not restore claude.exe from %s: %v", candidates[0], err)
		return
	}
	logf("restored claude.exe from %s (interrupted self-update)", filepath.Base(candidates[0]))
}

func resolveAppRoot(root string) (string, error) {
	if base := os.Getenv("LOCALAPPDATA"); base != "" {
		return filepath.Join(base, appName), nil
	}
	return root, nil
}

func subdir(base, name string) (string, error) {
	dir := filepath.Join(base, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating the %s folder %s: %w", name, dir, err)
	}
	return dir, nil
}

func occupied(port string) bool {
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return true
	}
	_ = ln.Close()
	return false
}

// Poll rather than parse stdout: the server's readiness line is not a contract,
// but the port accepting connections is.
func ready(port string, exited <-chan error) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-exited:
				return
			default:
			}
			conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, time.Second)
			if err == nil {
				_ = conn.Close()
				close(done)
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
	}()
	return done
}

/* --- what the window shows before the server is up --- */

const splashCSS = `
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #0f1621; color: #e7edf5;
    font: 15px/1.55 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
    -webkit-user-select: none; user-select: none;
  }
  main { text-align: center; padding: 0 2rem; max-width: 34rem; }
  h1 { margin: 0 0 .35rem; font-size: 1.35rem; font-weight: 600; letter-spacing: -.01em; }
  p { margin: 0; color: #93a4bb; }
  .dot {
    width: 46px; height: 46px; margin: 0 auto 1.4rem; border-radius: 50%;
    background: linear-gradient(#19afff, #0866e0);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.9); } 50% { opacity: 1; transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; opacity: 1; } }
`

var splashHTML = `<!doctype html><meta charset="utf-8"><title>` + appName + `</title><style>` + splashCSS +
	`</style><main><div class="dot"></div><h1>Starting Fleabook</h1><p>This takes a few seconds the first time.</p></main>`

func errorHTML(message string) string {
	return `<!doctype html><meta charset="utf-8"><title>` + appName + `</title><style>` + splashCSS +
		`.dot { animation: none; opacity: 1; background: #b4283c; }</style>` +
		`<main><div class="dot"></div><h1>Fleabook could not start</h1><p>` + escapeHTML(message) +
		`<br><br>Details are in ` + escapeHTML(logPath) + `</p></main>`
}

func escapeHTML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

/* --- logging: there is no console, so this is the only diagnostic channel --- */

const maxLogBytes = 1 << 20

var (
	logPath string
	logSink *os.File
)

func startLogging(appRoot string) error {
	dir, err := subdir(appRoot, "logs")
	if err != nil {
		return err
	}
	logPath = filepath.Join(dir, "fleabook.log")

	// Append across runs so a crash is still readable after a restart, but cap
	// it: this file is never rotated by anything else.
	if info, err := os.Stat(logPath); err == nil && info.Size() > maxLogBytes {
		_ = os.Remove(logPath)
	}

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		// Not fatal — losing the log is better than refusing to launch.
		logf("could not open the log file: %v", err)
		return nil
	}
	logSink = f
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags)
	return nil
}

func logf(format string, args ...any) {
	if logSink == nil {
		return
	}
	log.Printf(format, args...)
}

/* --- Win32: message box and the job object that kills the server --- */

const (
	mbOK            = 0x00000000
	mbIconError     = 0x00000010
	mbSetForeground = 0x00010000
	mbTopmost       = 0x00040000

	createNoWindow = 0x08000000

	smCXScreen = 0
	smCYScreen = 1
)

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW      = user32.NewProc("MessageBoxW")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

func alert(message string) {
	if logPath != "" {
		message += "\n\nDetails are in:\n" + logPath
	}
	text, err := syscall.UTF16PtrFromString(message)
	if err != nil {
		return
	}
	caption, err := syscall.UTF16PtrFromString(appName)
	if err != nil {
		return
	}
	_, _, _ = procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(text)),
		uintptr(unsafe.Pointer(caption)),
		mbOK|mbIconError|mbSetForeground|mbTopmost,
	)
}

const (
	jobObjectExtendedLimitInformation = 9
	limitKillOnJobClose               = 0x2000

	processTerminate = 0x0001
	processSetQuota  = 0x0100
)

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobExtendedLimitInformation struct {
	BasicLimitInformation jobBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW     = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObj = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobOb = kernel32.NewProc("AssignProcessToJobObject")
)

// The job handle is intentionally leaked: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
// fires when the last handle to the job closes, and holding it for the life of
// the process is exactly what makes the guarantee hold — including on a hard
// kill, where no Go code gets to run.
func superviseChild(pid int) error {
	job, _, err := procCreateJobObjectW.Call(0, 0)
	if job == 0 {
		return err
	}

	info := jobExtendedLimitInformation{}
	info.BasicLimitInformation.LimitFlags = limitKillOnJobClose

	ret, _, err := procSetInformationJobObj.Call(
		job,
		uintptr(jobObjectExtendedLimitInformation),
		uintptr(unsafe.Pointer(&info)),
		unsafe.Sizeof(info),
	)
	if ret == 0 {
		syscall.CloseHandle(syscall.Handle(job))
		return err
	}

	handle, err := syscall.OpenProcess(processTerminate|processSetQuota, false, uint32(pid))
	if err != nil {
		syscall.CloseHandle(syscall.Handle(job))
		return err
	}
	defer syscall.CloseHandle(handle)

	ret, _, err = procAssignProcessToJobOb.Call(job, uintptr(handle))
	if ret == 0 {
		syscall.CloseHandle(syscall.Handle(job))
		return err
	}
	return nil
}
