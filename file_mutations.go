package main

import (
	"errors"
	"os"
	"path/filepath"
)

func (a *App) UploadFile(id, dir, requestID string) (string, error) {
	c, err := a.client(id)
	if err != nil {
		return "", err
	}
	ctx, done, err := a.beginFileOperation(requestID)
	if err != nil {
		return "", err
	}
	defer done()
	local, err := a.chooseUploadFile()
	if err != nil || local == "" {
		return "", err
	}
	selected, err := os.Stat(local)
	if err != nil {
		return "", err
	}
	if !selected.Mode().IsRegular() {
		return "", errors.New("请选择普通文件上传")
	}
	source, err := os.Open(local)
	if err != nil {
		return "", err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("请选择普通文件上传")
	}
	return c.UploadFile(ctx, dir, filepath.Base(local), source, info.Size(), func(transferred, total int64, speed float64) {
		a.emit("download:progress", map[string]any{"requestId": requestID, "stage": "uploading", "transferred": transferred, "total": total, "bytesPerSecond": speed})
	})
}

func (a *App) DeleteFile(id, remote string) error {
	c, err := a.client(id)
	if err != nil {
		return err
	}
	return c.DeleteFile(a.ctx, remote)
}
