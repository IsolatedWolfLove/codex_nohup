//go:build !android

package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) emit(name string, data any) { runtime.EventsEmit(a.ctx, name, data) }
func (a *App) openURL(url string)         { runtime.BrowserOpenURL(a.ctx, url) }

func (a *App) ChoosePrivateKey() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择 SSH 私钥"})
}
func (a *App) ClipboardGetText() (string, error) {
	return runtime.ClipboardGetText(a.ctx)
}
func (a *App) ClipboardSetText(value string) error {
	return runtime.ClipboardSetText(a.ctx, value)
}
func (a *App) ConfirmKill(name string) (bool, error) {
	choice, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: "结束远端会话", Message: fmt.Sprintf("结束远端会话“%s”？其中运行的进程也会结束。", name), Buttons: []string{"结束会话", "取消"}, DefaultButton: "取消", CancelButton: "取消"})
	// Linux uses native Yes/No buttons and ignores custom button labels.
	return choice == "结束会话" || choice == "Yes", err
}

func (a *App) chooseDownloadPath(name string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "下载远端文件", DefaultFilename: name})
}

// Failed transfers leave an existing destination intact.
func (a *App) saveDownload(name string, transfer func(io.Writer) error) (string, error) {
	destination, err := a.chooseDownloadPath(name)
	if err != nil || destination == "" {
		return "", err
	}
	file, err := os.CreateTemp(filepath.Dir(destination), ".nohop-download-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	transferErr := transfer(file)
	closeErr := file.Close()
	if transferErr != nil {
		return "", transferErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if err := os.Rename(file.Name(), destination); err != nil {
		return "", err
	}
	return destination, nil
}
