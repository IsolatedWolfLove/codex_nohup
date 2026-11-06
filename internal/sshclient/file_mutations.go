package sshclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"
)

// UploadFile creates a new file exclusively, so an existing file or symlink is
// never overwritten. Failed transfers remove their partial destination.
func (c *Client) UploadFile(ctx context.Context, dir, name string, source io.Reader, total int64, progress func(int64, int64, float64)) (string, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") {
		return "", errors.New("无效的文件名")
	}
	ftp, windows, err := c.fileClient()
	if err != nil {
		return "", err
	}
	defer ftp.Close()
	stop := context.AfterFunc(ctx, func() { _ = ftp.Close() })
	defer stop()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if windows {
		dir = strings.ReplaceAll(dir, `\`, "/")
	}
	if dir == "" {
		return "", errors.New("请选择上传目录")
	}
	root, err := ftp.RealPath(dir)
	if err != nil {
		return "", err
	}
	info, err := ftp.Stat(root)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("上传目标必须是文件夹")
	}
	remote := path.Join(root, name)
	file, err := ftp.OpenFile(remote, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return "", fmt.Errorf("无法创建文件（同名文件不会覆盖）：%w", err)
	}
	complete := false
	defer func() {
		_ = file.Close()
		if !complete {
			// Cancellation closes the transfer channel; cleanup needs its own channel.
			cleanup, _, e := c.fileClient()
			if e == nil {
				defer cleanup.Close()
				_ = cleanup.Remove(remote)
			}
		}
	}()
	writer := &downloadWriter{dest: file, total: total, started: time.Now(), progress: progress}
	writer.report(true)
	n, err := io.Copy(writer, source)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if err != nil {
		return "", fmt.Errorf("上传失败：%w", err)
	}
	if n != total {
		return "", errors.New("上传期间本地文件大小发生变化，请重试")
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	complete = true
	writer.report(true)
	return remote, nil
}

// DeleteFile uses Lstat at every level: directory symlinks are unlinked rather
// than traversed. Never resolve the final path through RealPath.
func (c *Client) DeleteFile(ctx context.Context, remote string) error {
	ftp, windows, err := c.fileClient()
	if err != nil {
		return err
	}
	defer ftp.Close()
	stop := context.AfterFunc(ctx, func() { _ = ftp.Close() })
	defer stop()
	if windows {
		remote = strings.ReplaceAll(remote, `\`, "/")
	}
	remote = path.Clean(remote)
	if remote == "." || remote == "/" || remote == ".." || path.Base(remote) == "." || (windows && strings.HasSuffix(remote, ":")) {
		return errors.New("不能删除根目录或未指定的路径")
	}
	var remove func(string) error
	remove = func(target string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := ftp.Lstat(target)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ftp.Remove(target)
		}
		entries, err := ftp.ReadDir(target)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			name := entry.Name()
			if name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") {
				return errors.New("无效的远端文件名")
			}
			if err := remove(path.Join(target, name)); err != nil {
				return err
			}
		}
		return ftp.RemoveDirectory(target)
	}
	if err := remove(remote); err != nil {
		return fmt.Errorf("删除失败（部分项目可能已删除）：%w", err)
	}
	return nil
}
