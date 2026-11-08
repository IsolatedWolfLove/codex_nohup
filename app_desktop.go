//go:build !android

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) downloadRoot() (string, error) {
	base, err := os.UserCacheDir()
	return filepath.Join(base, "NohopCodex", "sftp-downloads"), err
}
func (a *App) exportDownload(ctx context.Context, staged string, progress func(int64, int64, float64)) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	destination, err := a.chooseDownloadPath(filepath.Base(staged))
	if err != nil || destination == "" {
		return "", err
	}
	if err := copyDownload(ctx, staged, destination, progress); err != nil {
		return "", err
	}
	return destination, nil
}

func (a *App) emit(name string, data any) { application.Get().Event.Emit(name, data) }
func (a *App) openURL(url string)         { application.Get().Browser.OpenURL(url) }

func (a *App) ChoosePrivateKey() (string, error) {
	return application.Get().Dialog.OpenFile().SetTitle("选择 SSH 私钥").PromptForSingleSelection()
}
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

func (a *App) chooseDownloadPath(name string) (string, error) {
	dialog := application.Get().Dialog.SaveFile()
	dialog.SetOptions(&application.SaveFileDialogOptions{Title: "下载远端文件"})
	return dialog.SetFilename(name).PromptForSingleSelection()
}

func (a *App) chooseUploadFile() (string, error) {
	return application.Get().Dialog.OpenFile().SetTitle("选择要上传的文件").PromptForSingleSelection()
}
