package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	"golang.org/x/crypto/ssh"
)

var isAndroidKeyStoreEnabled = func() bool { return runtime.GOOS == "android" }

type SSHKeyInfo struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	PublicKey   string `json:"publicKey"`
	Fingerprint string `json:"fingerprint"`
	Algorithm   string `json:"algorithm"`
	Encrypted   bool   `json:"encrypted"`
	IsDefault   bool   `json:"isDefault"`
}

var sshKeyNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)

var defaultSSHKeyNames = map[string]bool{
	"id_ed25519": true,
	"id_rsa":     true,
	"id_ecdsa":   true,
	"id_dsa":     true,
}

var reservedSSHFiles = map[string]bool{
	"config":          true,
	"known_hosts":     true,
	"known_hosts.old": true,
	"authorized_keys": true,
	"environment":     true,
	"rc":              true,
}

func sshDirPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ssh"), nil
}

func validateSSHKeyName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("请输入密钥名称")
	}
	if !sshKeyNamePattern.MatchString(name) || strings.Contains(name, "..") || strings.HasSuffix(strings.ToLower(name), ".pub") {
		return "", errors.New("密钥名称只能包含字母、数字、点、下划线和连字符，且不能以点开头或使用 .pub 后缀")
	}
	if reservedSSHFiles[strings.ToLower(name)] {
		return "", fmt.Errorf("不能使用保留文件名 %s", name)
	}
	return name, nil
}

func formatPublicKeyLine(pub ssh.PublicKey, comment string) string {
	line := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub)))
	comment = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(comment, "\r", ""), "\n", ""))
	if comment != "" {
		return line + " " + comment
	}
	return line
}

func readPublicKeyLine(path string, pub ssh.PublicKey) string {
	if data, err := os.ReadFile(path + ".pub"); err == nil {
		if parsed, comment, _, _, err := ssh.ParseAuthorizedKey(data); err == nil {
			if pub == nil || bytes.Equal(parsed.Marshal(), pub.Marshal()) {
				return formatPublicKeyLine(parsed, comment)
			}
		}
	}
	if pub != nil {
		return formatPublicKeyLine(pub, "")
	}
	return ""
}

func parseSSHKeyInfo(path string) (SSHKeyInfo, bool) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Size() > 1024*1024 {
		return SSHKeyInfo{}, false
	}
	data, err := os.ReadFile(path)
	if err != nil || !bytes.Contains(data, []byte("PRIVATE KEY-----")) {
		return SSHKeyInfo{}, false
	}
	name := filepath.Base(path)
	var pub ssh.PublicKey
	encrypted := false
	signer, err := ssh.ParsePrivateKey(data)
	if err != nil {
		var missing *ssh.PassphraseMissingError
		if !errors.As(err, &missing) {
			return SSHKeyInfo{}, false
		}
		encrypted = true
		pub = missing.PublicKey
	} else {
		pub = signer.PublicKey()
	}
	publicLine := readPublicKeyLine(path, pub)
	if pub == nil && publicLine != "" {
		pub, _, _, _, _ = ssh.ParseAuthorizedKey([]byte(publicLine))
	}
	fingerprint, algorithm := "", ""
	if pub != nil {
		fingerprint = ssh.FingerprintSHA256(pub)
		algorithm = strings.ToUpper(strings.TrimPrefix(pub.Type(), "ssh-"))
	}
	return SSHKeyInfo{
		Name:        name,
		Path:        "~/.ssh/" + name,
		PublicKey:   publicLine,
		Fingerprint: fingerprint,
		Algorithm:   algorithm,
		Encrypted:   encrypted,
		IsDefault:   defaultSSHKeyNames[name],
	}, true
}

func writePrivateKeyExclusive(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return fmt.Errorf("密钥 %s 已存在，请更换名称或先删除旧密钥", filepath.Base(path))
		}
		return err
	}
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil {
		_ = os.Remove(path)
		return writeErr
	}
	if closeErr != nil {
		_ = os.Remove(path)
		return closeErr
	}
	_ = os.Chmod(path, 0600)
	return nil
}

func (a *App) ListSSHKeys() ([]SSHKeyInfo, error) {
	if !isAndroidKeyStoreEnabled() {
		return []SSHKeyInfo{}, nil
	}
	dir, err := sshDirPath()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []SSHKeyInfo{}, nil
	}
	if err != nil {
		return nil, err
	}
	keys := []SSHKeyInfo{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if reservedSSHFiles[strings.ToLower(name)] || strings.HasSuffix(strings.ToLower(name), ".pub") {
			continue
		}
		if key, ok := parseSSHKeyInfo(filepath.Join(dir, name)); ok {
			keys = append(keys, key)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].IsDefault != keys[j].IsDefault {
			return keys[i].IsDefault
		}
		return keys[i].Name < keys[j].Name
	})
	return keys, nil
}

func (a *App) GenerateSSHKey(name, passphrase, comment string) (SSHKeyInfo, error) {
	if !isAndroidKeyStoreEnabled() {
		return SSHKeyInfo{}, errors.New("本机密钥库仅在 Android 端启用，桌面端请直接使用 ~/.ssh 目录")
	}
	if strings.TrimSpace(name) == "" {
		name = "id_ed25519"
	}
	validName, err := validateSSHKeyName(name)
	if err != nil {
		return SSHKeyInfo{}, err
	}
	comment = strings.TrimSpace(comment)
	if comment == "" {
		comment = "nohop-codex"
	}
	dir, err := sshDirPath()
	if err != nil {
		return SSHKeyInfo{}, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return SSHKeyInfo{}, err
	}
	pubRaw, privRaw, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return SSHKeyInfo{}, err
	}
	var block *pem.Block
	if passphrase != "" {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(privRaw, comment, []byte(passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(privRaw, comment)
	}
	if err != nil {
		return SSHKeyInfo{}, err
	}
	pub, err := ssh.NewPublicKey(pubRaw)
	if err != nil {
		return SSHKeyInfo{}, err
	}
	keyPath := filepath.Join(dir, validName)
	if err = writePrivateKeyExclusive(keyPath, pem.EncodeToMemory(block)); err != nil {
		return SSHKeyInfo{}, err
	}
	pubLine := formatPublicKeyLine(pub, comment)
	_ = os.WriteFile(keyPath+".pub", []byte(pubLine+"\n"), 0644)
	return SSHKeyInfo{
		Name:        validName,
		Path:        "~/.ssh/" + validName,
		PublicKey:   pubLine,
		Fingerprint: ssh.FingerprintSHA256(pub),
		Algorithm:   "ED25519",
		Encrypted:   passphrase != "",
		IsDefault:   defaultSSHKeyNames[validName],
	}, nil
}

func (a *App) ImportSSHKey(name, content, passphrase string) (SSHKeyInfo, error) {
	if !isAndroidKeyStoreEnabled() {
		return SSHKeyInfo{}, errors.New("本机密钥库仅在 Android 端启用，桌面端请直接使用 ~/.ssh 目录")
	}
	validName, err := validateSSHKeyName(name)
	if err != nil {
		return SSHKeyInfo{}, err
	}
	normalized := strings.TrimSpace(strings.ReplaceAll(content, "\r\n", "\n"))
	if normalized == "" {
		return SSHKeyInfo{}, errors.New("请粘贴私钥内容")
	}
	raw := []byte(normalized + "\n")
	if len(raw) > 1024*1024 {
		return SSHKeyInfo{}, errors.New("私钥文件不能超过 1 MiB")
	}
	var pub ssh.PublicKey
	signer, err := ssh.ParsePrivateKey(raw)
	if err != nil {
		var missing *ssh.PassphraseMissingError
		if !errors.As(err, &missing) {
			return SSHKeyInfo{}, fmt.Errorf("无法解析私钥：%w", err)
		}
		pub = missing.PublicKey
		if passphrase != "" {
			unlocked, unlockErr := ssh.ParsePrivateKeyWithPassphrase(raw, []byte(passphrase))
			if unlockErr != nil {
				return SSHKeyInfo{}, fmt.Errorf("私钥口令不正确或无法解析：%w", unlockErr)
			}
			pub = unlocked.PublicKey()
		}
	} else {
		pub = signer.PublicKey()
	}
	dir, err := sshDirPath()
	if err != nil {
		return SSHKeyInfo{}, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return SSHKeyInfo{}, err
	}
	keyPath := filepath.Join(dir, validName)
	if err = writePrivateKeyExclusive(keyPath, raw); err != nil {
		return SSHKeyInfo{}, err
	}
	if pub != nil {
		_ = os.WriteFile(keyPath+".pub", []byte(formatPublicKeyLine(pub, "")+"\n"), 0644)
	}
	info, ok := parseSSHKeyInfo(keyPath)
	if !ok {
		return SSHKeyInfo{}, errors.New("已保存但无法读取密钥信息")
	}
	return info, nil
}

func (a *App) DeleteSSHKey(name string) error {
	if !isAndroidKeyStoreEnabled() {
		return errors.New("本机密钥库仅在 Android 端启用，桌面端请直接使用 ~/.ssh 目录")
	}
	validName, err := validateSSHKeyName(name)
	if err != nil {
		return err
	}
	dir, err := sshDirPath()
	if err != nil {
		return err
	}
	keyPath := filepath.Join(dir, validName)
	if _, ok := parseSSHKeyInfo(keyPath); !ok {
		return errors.New("未找到对应的私钥文件")
	}
	if err := os.Remove(keyPath); err != nil {
		return err
	}
	_ = os.Remove(keyPath + ".pub")
	return nil
}
