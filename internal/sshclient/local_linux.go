//go:build linux && !android

package sshclient

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"

	"golang.org/x/sys/unix"
)

type nativeProcess struct {
	closeOnce
	cmd    *exec.Cmd
	master *os.File
}

func startLocalProcess(backend, name, cwd string, cols, rows int) (localProcess, error) {
	command, err := attachCommand(backend, name, cwd)
	if err != nil {
		return nil, err
	}
	// Open a Linux PTY directly; no SSH daemon or loopback socket is involved.
	fd, err := unix.Open("/dev/ptmx", unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	master := os.NewFile(uintptr(fd), "/dev/ptmx")
	ok := false
	defer func() {
		if !ok {
			master.Close()
		}
	}()
	if err = unix.IoctlSetPointerInt(fd, unix.TIOCSPTLCK, 0); err != nil {
		return nil, err
	}
	number, err := unix.IoctlGetInt(fd, unix.TIOCGPTN)
	if err != nil {
		return nil, err
	}
	slave, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", number), os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, err
	}
	defer slave.Close()
	cmd := exec.Command("/bin/sh", "-c", command)
	cmd.Env = localEnvironment()
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	p := &nativeProcess{cmd: cmd, master: master}
	if err = p.WindowChange(rows, cols); err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	ok = true
	return p, nil
}
func (p *nativeProcess) Read(data []byte) (int, error)  { return p.master.Read(data) }
func (p *nativeProcess) Write(data []byte) (int, error) { return p.master.Write(data) }
func (p *nativeProcess) WindowChange(rows, cols int) error {
	return unix.IoctlSetWinsize(int(p.master.Fd()), unix.TIOCSWINSZ, &unix.Winsize{Row: uint16(rows), Col: uint16(cols)})
}
func (p *nativeProcess) Wait() error { return p.cmd.Wait() }
func (p *nativeProcess) Close() error {
	p.once.Do(func() {
		p.err = p.master.Close()
		if p.cmd.Process != nil {
			_ = p.cmd.Process.Kill()
		}
	})
	return p.err
}
