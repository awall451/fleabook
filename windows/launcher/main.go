//go:build windows

// Fleabook's Windows launcher.
//
// The app itself is the same SvelteKit/adapter-node server that runs under
// Docker on Linux. All this does is the work Docker Compose does there: set the
// handful of environment variables the server cannot infer, start Node, wait for
// the port, and open a browser. Nothing app-specific lives here — if it needs a
// code change, it belongs in the server, not the launcher.
//
// Deliberately stdlib-only, so the build is `GOOS=windows go build` with no
// module downloads and no cgo.
package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

// Pinned, not chosen dynamically.
//
// SvelteKit's CSRF check compares the browser's Origin against the origin the
// server derives for itself, and adapter-node assumes https when there is no
// proxy telling it otherwise. The build works around that with an explicit
// trusted-origin list in vite.config.ts — which names this port. Picking a free
// port at runtime would silently land outside that list and 403 every photo
// upload, so a busy port is reported as an error instead.
const port = "5180"

const startupTimeout = 90 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\nFleabook could not start: %v\n", err)
		pause()
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
			return fmt.Errorf("%s is missing — the folder looks incomplete, try unzipping the download again", required)
		}
	}

	dataDir, err := resolveDataDir(root)
	if err != nil {
		return err
	}

	if occupied(port) {
		return fmt.Errorf(
			"port %s is already in use.\nAnother copy of Fleabook is probably already running — check your taskbar before starting a second one", port)
	}

	cmd := exec.Command(node, server)
	cmd.Dir = root
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = append(os.Environ(),
		"NODE_ENV=production",
		"DATA_DIR="+dataDir,
		"HOST=127.0.0.1",
		"PORT="+port,
		// adapter-node defaults to 512K, which rejects a single phone photo —
		// they run 3-12MB each. Docker Compose sets the same value for the same
		// reason; both copies matter, because neither path reads the other's.
		"BODY_SIZE_LIMIT=128M",
	)

	fmt.Printf("Fleabook\n\nYour listings and photos are stored in:\n  %s\n\nStarting…\n", dataDir)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("starting the server: %w", err)
	}

	// Tie Node's lifetime to this window. Without it, closing the console with
	// the X button orphans node.exe, which keeps holding the port and makes the
	// next launch fail with a confusing "already in use".
	if err := superviseChild(cmd.Process.Pid); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not link the server to this window (%v).\n"+
			"If Fleabook won't start next time, end node.exe in Task Manager first.\n", err)
	}

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	url := "http://127.0.0.1:" + port

	select {
	case err := <-exited:
		return fmt.Errorf("the server stopped during startup: %w", err)
	case <-ready(port, exited):
		fmt.Printf("\nFleabook is running at %s\n", url)
		fmt.Println("Opening your browser. Close this window to stop Fleabook.")
		openBrowser(url)
	case <-time.After(startupTimeout):
		_ = cmd.Process.Kill()
		return fmt.Errorf("the server did not finish starting within %s", startupTimeout)
	}

	// Ctrl+C should stop Node too, not just detach from it.
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-exited:
		if err != nil {
			return fmt.Errorf("the server stopped unexpectedly: %w", err)
		}
	case <-interrupt:
		fmt.Println("\nStopping…")
		_ = cmd.Process.Kill()
		<-exited
	}
	return nil
}

// Listings, photos, and the meetup note live outside the program folder so an
// install under Program Files — which is read-only for normal users — still
// works, and so replacing the app folder on upgrade never touches user data.
func resolveDataDir(root string) (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	dir := filepath.Join(root, "data")
	if base != "" {
		dir = filepath.Join(base, "Fleabook", "data")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating the data folder %s: %w", dir, err)
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

// rundll32 rather than `cmd /c start`: no shell, so nothing in the URL is ever
// interpreted as a command.
func openBrowser(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func pause() {
	fmt.Println("\nPress Enter to close this window.")
	var discard [1]byte
	_, _ = os.Stdin.Read(discard[:])
}

/* --- Windows job object: kill the server when this window closes --- */

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
// window close, where no Go code gets to run.
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
