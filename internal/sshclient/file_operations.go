package sshclient

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"
	"unicode/utf8"
)

func (c *Client) FileSourceIdentity() (string, error) {
	conn, err := c.current()
	if err != nil {
		return "", err
	}
	if conn.local {
		return "", errors.New("请选择 SSH 服务器")
	}
	return conn.info.Host + "|" + conn.client.User() + "|" + conn.client.RemoteAddr().String(), nil
}

func (c *Client) FileMetadata(ctx context.Context, remote string) (RemoteFile, error) {
	ftp, windows, err := c.fileClient()
	if err != nil {
		return RemoteFile{}, err
	}
	defer ftp.Close()
	stop := context.AfterFunc(ctx, func() { _ = ftp.Close() })
	defer stop()
	if err := ctx.Err(); err != nil {
		return RemoteFile{}, err
	}
	if windows {
		remote = strings.ReplaceAll(remote, `\`, "/")
	}
	resolved, err := ftp.RealPath(remote)
	if err != nil {
		return RemoteFile{}, err
	}
	info, err := ftp.Stat(resolved)
	if err != nil {
		return RemoteFile{}, err
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return RemoteFile{}, errors.New("请选择普通文件或文件夹")
	}
	return RemoteFile{Name: path.Base(resolved), Path: resolved, IsDir: info.IsDir(), Size: info.Size(), Modified: info.ModTime().Unix()}, nil
}

// Build ZIP locally over SFTP: no shell interpolation, remote tools or temporary
// archives on the server. Symlinks and special files are deliberately omitted.
func (c *Client) DownloadDirectory(ctx context.Context, remote string, dest io.Writer, progress func(int64, int64, float64)) error {
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
	root, err := ftp.RealPath(remote)
	if err != nil {
		return err
	}
	info, err := ftp.Stat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("请选择文件夹打包")
	}
	type item struct {
		remote, name string
		info         os.FileInfo
	}
	items := []item{}
	var total int64
	var walk func(string, string) error
	walk = func(dir, name string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		entries, err := ftp.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Name() == "." || entry.Name() == ".." || strings.ContainsAny(entry.Name(), `/\`) {
				return errors.New("无效的远端文件名")
			}
			if entry.Mode()&os.ModeSymlink != 0 || (!entry.IsDir() && !entry.Mode().IsRegular()) {
				continue
			}
			file, archive := path.Join(dir, entry.Name()), path.Join(name, entry.Name())
			items = append(items, item{file, archive, entry})
			if entry.IsDir() {
				if err := walk(file, archive); err != nil {
					return err
				}
			} else {
				total += entry.Size()
			}
		}
		return nil
	}
	name := path.Base(root)
	if name == "/" || name == "." {
		name = "files"
	}
	items = append(items, item{root, name, info})
	if err := walk(root, name); err != nil {
		return err
	}
	archive := zip.NewWriter(dest)
	writer := &downloadWriter{total: total, started: time.Now(), progress: progress}
	writer.report(true)
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(item.info)
		if err != nil {
			return err
		}
		header.Name = item.name
		if item.info.IsDir() {
			header.Name += "/"
		} else {
			header.Method = zip.Deflate
		}
		output, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		if item.info.IsDir() {
			continue
		}
		// Recheck before opening so a symlink or special file introduced during
		// enumeration is not followed into a different tree or a blocking FIFO.
		current, err := ftp.Lstat(item.remote)
		if err != nil {
			return err
		}
		if !current.Mode().IsRegular() {
			return fmt.Errorf("打包期间文件类型发生变化：%s", item.name)
		}
		file, err := ftp.Open(item.remote)
		if err != nil {
			return err
		}
		writer.dest = output
		n, copyErr := file.WriteTo(writer)
		after, statErr := file.Stat()
		_ = file.Close()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if copyErr != nil {
			return copyErr
		}
		if statErr != nil {
			return statErr
		}
		if n != item.info.Size() || after.Size() != item.info.Size() || after.ModTime() != item.info.ModTime() {
			return fmt.Errorf("打包期间文件发生变化：%s", item.name)
		}
	}
	if err := archive.Close(); err != nil {
		return err
	}
	writer.report(true)
	return ctx.Err()
}

type FilePreview struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	MIME      string `json:"mime"`
	Data      string `json:"data"`
	Truncated bool   `json:"truncated"`
}

func (c *Client) PreviewFile(ctx context.Context, remote string) (FilePreview, error) {
	result := FilePreview{Name: path.Base(strings.ReplaceAll(remote, `\`, "/"))}
	limit := int64(20 * 1024 * 1024)
	switch strings.ToLower(path.Ext(result.Name)) {
	case ".md", ".markdown":
		result.Kind, result.MIME, limit = "markdown", "text/markdown", 1024*1024
	case ".txt", ".log":
		result.Kind, result.MIME, limit = "text", "text/plain", 1024*1024
	case ".pdf":
		result.Kind, result.MIME = "pdf", "application/pdf"
	case ".png":
		result.Kind, result.MIME = "image", "image/png"
	case ".jpg", ".jpeg":
		result.Kind, result.MIME = "image", "image/jpeg"
	case ".gif":
		result.Kind, result.MIME = "image", "image/gif"
	case ".webp":
		result.Kind, result.MIME = "image", "image/webp"
	case ".bmp":
		result.Kind, result.MIME = "image", "image/bmp"
	default:
		return result, errors.New("暂不支持此文件格式预览")
	}
	ftp, windows, err := c.fileClient()
	if err != nil {
		return result, err
	}
	defer ftp.Close()
	stop := context.AfterFunc(ctx, func() { _ = ftp.Close() })
	defer stop()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if windows {
		remote = strings.ReplaceAll(remote, `\`, "/")
	}
	info, err := ftp.Stat(remote)
	if err != nil {
		return result, err
	}
	if !info.Mode().IsRegular() {
		return result, errors.New("请选择普通文件预览")
	}
	if result.Kind != "text" && result.Kind != "markdown" && info.Size() > limit {
		return result, errors.New("PDF 和图片预览最大支持 20 MiB，请下载后查看")
	}
	file, err := ftp.Open(remote)
	if err != nil {
		return result, err
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return result, err
	}
	if !info.Mode().IsRegular() {
		return result, errors.New("请选择普通文件预览")
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	if err != nil {
		return result, err
	}
	if len(data) > int(limit) {
		if result.Kind != "text" && result.Kind != "markdown" {
			return result, errors.New("文件超过预览大小限制")
		}
		data, result.Truncated = data[:limit], true
		for len(data) > 0 && !utf8.Valid(data) && !utf8.RuneStart(data[len(data)-1]) {
			data = data[:len(data)-1]
		}
	}
	if result.Kind == "text" || result.Kind == "markdown" {
		result.Data = strings.ToValidUTF8(string(data), "�")
	} else {
		result.Data = base64.StdEncoding.EncodeToString(data)
	}
	return result, nil
}
