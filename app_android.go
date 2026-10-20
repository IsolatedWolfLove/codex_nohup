package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) emit(name string, data any) { application.Get().Event.Emit(name, data) }
func (a *App) openURL(url string)         { application.Android.OpenURL(url) }

func (a *App) ChoosePrivateKey() (string, error) {
	path, err := application.Get().Dialog.OpenFile().SetTitle("导入 SSH 私钥").PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	source, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer source.Close()
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	// SAF imports are temporary cache copies; retain a private persistent copy.
	dest, err := os.CreateTemp(dir, "imported-key-*")
	if err != nil {
		return "", err
	}
	name := dest.Name()
	n, copyErr := io.Copy(dest, io.LimitReader(source, 1024*1024+1))
	closeErr := dest.Close()
	if copyErr != nil || closeErr != nil || n > 1024*1024 {
		_ = os.Remove(name)
		return "", fmt.Errorf("无法导入私钥（最大 1 MiB）")
	}
	return name, nil
}

func (a *App) ClipboardGetImage() (string, error) { return "", nil }
func (a *App) ClipboardGetText() (string, error) {
	text, _ := application.Get().Clipboard.Text()
	return text, nil
}
func (a *App) ClipboardSetText(value string) error {
	if !application.Get().Clipboard.SetText(value) {
		return fmt.Errorf("无法写入剪贴板")
	}
	return nil
}
func (a *App) ConfirmKill(name string) (bool, error) {
	result := make(chan bool, 1)
	dialog := application.Get().Dialog.Question().SetTitle("结束远端会话").SetMessage(fmt.Sprintf("结束远端会话“%s”？其中运行的进程也会结束。", name))
	dialog.AddButton("取消").SetAsDefault().SetAsCancel().OnClick(func() { result <- false })
	dialog.AddButton("结束会话").OnClick(func() { result <- true })
	dialog.Show()
	select {
	case confirmed := <-result:
		return confirmed, nil
	case <-a.ctx.Done():
		return false, a.ctx.Err()
	}
}

// The Android adapter exports this completed staging file through ACTION_CREATE_DOCUMENT.
func (a *App) saveDownload(name string, transfer func(io.Writer) error) (string, error) {
	base := application.Android.StoragePath()
	if base == "" {
		return "", fmt.Errorf("Android 私有存储不可用")
	}
	return stageDownload(filepath.Join(base, "sftp-downloads"), name, transfer)
}
