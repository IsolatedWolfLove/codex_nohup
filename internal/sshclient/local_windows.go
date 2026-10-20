//go:build windows

package sshclient

import (
	"context"
	"fmt"
	"os"

	"github.com/UserExistsError/conpty"
)

type nativeProcess struct {
	closeOnce
	console *conpty.ConPty
}

func startLocalProcess(_, _, cwd string, cols, rows int) (localProcess, error) {
	if cwd == "" {
		cwd, _ = os.UserHomeDir()
	}
	console, err := conpty.Start("powershell.exe -NoLogo", conpty.ConPtyDimensions(cols, rows), conpty.ConPtyWorkDir(cwd))
	if err != nil {
		return nil, err
	}
	return &nativeProcess{console: console}, nil
}
func (p *nativeProcess) Read(data []byte) (int, error)     { return p.console.Read(data) }
func (p *nativeProcess) Write(data []byte) (int, error)    { return p.console.Write(data) }
func (p *nativeProcess) WindowChange(rows, cols int) error { return p.console.Resize(cols, rows) }
func (p *nativeProcess) Wait() error {
	code, err := p.console.Wait(context.Background())
	if err == nil && code != 0 {
		return fmt.Errorf("本机会话已退出（%d）", code)
	}
	return err
}
func (p *nativeProcess) Close() error { p.once.Do(func() { p.err = p.console.Close() }); return p.err }
