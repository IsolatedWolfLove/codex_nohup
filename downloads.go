package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"nohop-codex/internal/sshclient"
)

func (a *App) beginFileOperation(id string) (context.Context, func(), error) {
	if id == "" || len(id) > 256 {
		return nil, nil, errors.New("无效下载请求 ID")
	}
	a.downloadsMu.Lock()
	defer a.downloadsMu.Unlock()
	if a.downloads == nil {
		a.downloads = map[string]context.CancelFunc{}
	}
	if _, exists := a.downloads[id]; exists {
		return nil, nil, errors.New("任务正在运行")
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	a.downloads[id] = cancel
	return ctx, func() {
		cancel()
		a.downloadsMu.Lock()
		delete(a.downloads, id)
		a.downloadsMu.Unlock()
	}, nil
}

func (a *App) CancelDownload(requestID string) {
	a.downloadsMu.Lock()
	cancel := a.downloads[requestID]
	a.downloadsMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func downloadPaths(root, requestID string) (state, partial, ready string) {
	sum := sha256.Sum256([]byte(requestID))
	key := hex.EncodeToString(sum[:])
	return filepath.Join(root, "task-"+key+".json"), filepath.Join(root, "task-"+key+".part"), filepath.Join(root, "download-"+key)
}

type downloadSource struct {
	ConnectionID string               `json:"connectionId"`
	Server       string               `json:"server"`
	File         sshclient.RemoteFile `json:"file"`
	Folder       bool                 `json:"folder"`
}

// Keep only incomplete or not-yet-exported transfers. A stable request ID makes
// retries and app restarts use the same bytes, without reopening the destination.
func prepareDownload(ctx context.Context, root, requestID string, source downloadSource,
	transfer func(io.Writer, int64) error) (string, error) {
	if strings.ContainsAny(source.File.Name, `/\`) || source.File.Name == "" || source.File.Name == "." || source.File.Name == ".." {
		return "", errors.New("无效的下载文件名")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	state, partial, ready := downloadPaths(root, requestID)
	if data, err := os.ReadFile(state); err == nil {
		var previous downloadSource
		if json.Unmarshal(data, &previous) != nil || previous != source {
			return "", errors.New("远端文件或下载来源已变化，请移除下载记录后重新下载")
		}
	} else if !os.IsNotExist(err) {
		return "", err
	} else {
		// An orphaned part must never be associated with a new remote source.
		if err := os.Remove(partial); err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err := os.RemoveAll(ready); err != nil {
			return "", err
		}
		data, err := json.Marshal(source)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(state, data, 0600); err != nil {
			return "", err
		}
	}
	name := source.File.Name
	if source.Folder {
		name += ".zip"
	}
	if err := os.MkdirAll(ready, 0700); err != nil {
		return "", err
	}
	completed := filepath.Join(ready, name)
	if info, err := os.Stat(completed); err == nil && info.Mode().IsRegular() {
		if source.Folder || info.Size() == source.File.Size {
			return completed, ctx.Err()
		}
		return "", errors.New("本地下载缓存不完整，请移除记录后重试")
	}
	flags := os.O_CREATE | os.O_RDWR
	if source.Folder {
		flags |= os.O_TRUNC
	}
	file, err := os.OpenFile(partial, flags, 0600)
	if err != nil {
		return "", err
	}
	offset, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		file.Close()
		return "", err
	}
	if !source.Folder && offset > source.File.Size {
		file.Close()
		return "", errors.New("续传缓存超过远端文件大小，请移除记录后重试")
	}
	if ctx.Err() != nil {
		file.Close()
		return "", ctx.Err()
	}
	err = transfer(file, offset)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.Rename(partial, completed); err != nil {
		return "", err
	}
	return completed, nil
}

// Called after native export succeeds, or when the user discards a saved task.
func (a *App) ForgetDownload(requestID string) error {
	a.downloadsMu.Lock()
	defer a.downloadsMu.Unlock()
	if _, active := a.downloads[requestID]; active {
		return errors.New("请先取消并等待下载停止")
	}
	root, err := a.downloadRoot()
	if err != nil {
		return err
	}
	state, partial, ready := downloadPaths(root, requestID)
	for _, file := range []string{partial, state} {
		if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return os.RemoveAll(ready)
}

func (a *App) DownloadFolder(id, remote, requestID string) (string, error) {
	return a.download(id, remote, requestID, true)
}

func (a *App) download(id, remote, requestID string, folder bool) (string, error) {
	ctx, finish, err := a.beginFileOperation(requestID)
	if err != nil {
		return "", err
	}
	defer finish()
	c, err := a.client(id)
	if err != nil {
		return "", err
	}
	info, err := c.FileMetadata(ctx, remote)
	if ctx.Err() != nil {
		return "", errors.New("已取消下载，进度已保留")
	}
	if err != nil {
		return "", err
	}
	if info.IsDir != folder {
		return "", errors.New("文件类型已变化，请刷新列表后重试")
	}
	if folder && (info.Name == "/" || info.Name == ".") {
		info.Name = "files"
	}
	root, err := a.downloadRoot()
	if err != nil {
		return "", err
	}
	stage := "downloading"
	if folder {
		stage = "packing"
	}
	progress := func(done, total int64, speed float64) {
		a.emit("download:progress", map[string]any{"requestId": requestID, "stage": stage, "transferred": done, "total": total, "bytesPerSecond": speed})
	}
	server, err := c.FileSourceIdentity()
	if err != nil {
		return "", err
	}
	staged, err := prepareDownload(ctx, root, requestID, downloadSource{ConnectionID: id, Server: server, File: info, Folder: folder}, func(dest io.Writer, offset int64) error {
		if folder {
			return c.DownloadDirectory(ctx, info.Path, dest, progress)
		}
		return c.DownloadFileRange(ctx, info.Path, dest, offset, &info, progress)
	})
	if ctx.Err() != nil {
		return "", errors.New("已取消下载，进度已保留")
	}
	if err != nil {
		return "", err
	}
	return a.exportDownload(ctx, staged, func(done, total int64, speed float64) {
		a.emit("download:progress", map[string]any{"requestId": requestID, "stage": "saving", "transferred": done, "total": total, "bytesPerSecond": speed})
	})
}

func (a *App) PreviewFile(id, remote, requestID string) (sshclient.FilePreview, error) {
	ctx, finish, err := a.beginFileOperation(requestID)
	if err != nil {
		return sshclient.FilePreview{}, err
	}
	defer finish()
	c, err := a.client(id)
	if err != nil {
		return sshclient.FilePreview{}, err
	}
	return c.PreviewFile(ctx, remote)
}

type exportWriter struct {
	ctx           context.Context
	dest          io.Writer
	done, total   int64
	started, last time.Time
	progress      func(int64, int64, float64)
}

func (w *exportWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.dest.Write(data)
	w.done += int64(n)
	if time.Since(w.last) >= 200*time.Millisecond {
		w.last = time.Now()
		w.progress(w.done, w.total, float64(w.done)/time.Since(w.started).Seconds())
	}
	return n, err
}

func copyDownload(ctx context.Context, staged, destination string, progress func(int64, int64, float64)) error {
	in, err := os.Open(staged)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.CreateTemp(filepath.Dir(destination), ".nohop-download-*")
	if err != nil {
		return err
	}
	defer os.Remove(out.Name())
	writer := &exportWriter{ctx: ctx, dest: out, total: info.Size(), started: time.Now(), progress: progress}
	progress(0, info.Size(), 0)
	_, err = io.Copy(writer, in)
	if err == nil {
		err = out.Sync()
	}
	closeErr := out.Close()
	if err != nil {
		return fmt.Errorf("保存失败：%w", err)
	}
	if closeErr != nil {
		return closeErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Rename(out.Name(), destination); err != nil {
		return err
	}
	progress(info.Size(), info.Size(), 0)
	return nil
}
