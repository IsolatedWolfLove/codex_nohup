package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Stage a completed download for Android's document picker. Each export owns a directory.
func stageDownload(root, name string, transfer func(io.Writer) error) (string, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("无效的下载文件名")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	// Recover space after a process kill before Java could finish the export.
	entries, _ := os.ReadDir(root)
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil && entry.IsDir() && strings.HasPrefix(entry.Name(), "download-") && time.Since(info.ModTime()) > 24*time.Hour {
			_ = os.RemoveAll(filepath.Join(root, entry.Name()))
		}
	}
	dir, err := os.MkdirTemp(root, "download-")
	if err != nil {
		return "", err
	}
	completed := false
	defer func() {
		if !completed {
			_ = os.RemoveAll(dir)
		}
	}()
	file, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	transferErr := transfer(file)
	closeErr := file.Close()
	if transferErr != nil {
		return "", transferErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	completed = true
	return file.Name(), nil
}
