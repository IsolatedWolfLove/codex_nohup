package sshclient

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)
var screenSession = regexp.MustCompile(`^\s*(\d+\.\S+)`)

func normalizeName(value string) string {
	value = strings.Trim(unsafeName.ReplaceAllString(strings.TrimSpace(value), "-"), "-")
	if len(value) > 60 {
		value = value[:60]
	}
	if value == "" {
		return "nohop"
	}
	return value
}
func quoteSh(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }
func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
func psCommand(s string) string {
	units := utf16.Encode([]rune(s))
	b := make([]byte, len(units)*2)
	for i, v := range units {
		binary.LittleEndian.PutUint16(b[i*2:], v)
	}
	return "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + base64.StdEncoding.EncodeToString(b)
}

const supportProbe = "if command -v tmux >/dev/null 2>&1; then echo tmux; elif command -v screen >/dev/null 2>&1; then echo screen; else echo none; fi"

func parseBackend(s string) string {
	f := strings.Fields(s)
	if len(f) > 0 {
		v := f[len(f)-1]
		if v == "tmux" || v == "screen" {
			return v
		}
	}
	return "none"
}
func listCommand(backend string) string {
	if backend == "tmux" {
		return "tmux list-sessions -F " + quoteSh("#{session_name}\x01#{session_windows}\x01#{session_attached}\x01#{session_created}") + " 2>/dev/null || true"
	}
	if backend == "screen" {
		return "screen -ls 2>/dev/null || true"
	}
	return ""
}
func parseSessions(backend, output string) []PersistentSession {
	result := []PersistentSession{}
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		if backend == "tmux" {
			f := strings.Split(line, "\x01")
			if len(f) != 4 || f[0] == "" {
				continue
			}
			w, _ := strconv.Atoi(f[1])
			a, _ := strconv.Atoi(f[2])
			c, _ := strconv.ParseInt(f[3], 10, 64)
			result = append(result, PersistentSession{Name: f[0], Windows: w, Attached: a > 0, CreatedAt: c, Backend: backend})
		}
		if backend == "screen" {
			m := screenSession.FindStringSubmatch(line)
			if m != nil {
				result = append(result, PersistentSession{Name: m[1], Attached: strings.Contains(strings.ToLower(line), "(attached)"), Backend: backend})
			}
		}
	}
	return result
}
func attachCommand(backend, name, cwd string) (string, error) {
	name = normalizeName(name)
	cwd = strings.TrimSpace(cwd)
	switch backend {
	case "tmux":
		dir := ""
		if cwd != "" {
			dir = " -c " + quoteSh(cwd)
		}
		return "if tmux has-session -t " + quoteSh("="+name) + " 2>/dev/null; then exec tmux -u attach-session -t " + quoteSh("="+name) + "; else exec tmux -u new-session -s " + quoteSh(name) + dir + "; fi", nil
	case "screen":
		dir := ""
		if cwd != "" {
			dir = "cd " + quoteSh(cwd) + " && "
		}
		return dir + "exec screen -xRR -S " + quoteSh(name), nil
	}
	return "", errors.New("远端未安装 tmux 或 screen")
}
func killCommand(backend, name string) (string, error) {
	if backend == "tmux" {
		return "tmux kill-session -t " + quoteSh("="+name), nil
	}
	if backend == "screen" {
		return "screen -S " + quoteSh(name) + " -X quit", nil
	}
	return "", errors.New("当前后端不支持结束会话")
}
func dimension(v, fallback int) int {
	if v < 1 || v > 500 {
		return fallback
	}
	return v
}
