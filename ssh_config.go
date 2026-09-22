package main

import (
	"bufio"
	"errors"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"

	"nohop-codex/internal/sshclient"
)

func sshConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil { return "", err }
	return filepath.Join(home, ".ssh", "config"), nil
}

func (a *App) GetSSHConfig() (string, error) {
	path, err := sshConfigPath()
	if err != nil { return "", err }
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) { return "", nil }
	return string(data), err
}

func (a *App) SaveSSHConfig(content string) error {
	path, err := sshConfigPath()
	if err != nil { return err }
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil { return err }
	if err = os.WriteFile(path, []byte(content), 0600); err != nil { return err }
	return os.Chmod(path, 0600)
}

type configBlock struct { patterns []string; values map[string]string }

func parseSSHConfig(content string) ([]configBlock, []string) {
	blocks := []configBlock{{patterns: []string{"*"}, values: map[string]string{}}}
	aliases, seen := []string{}, map[string]bool{}
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") { continue }
		if i := strings.Index(line, " #"); i >= 0 { line = line[:i] }
		fields := strings.Fields(line)
		if len(fields) < 2 { continue }
		key, value := strings.ToLower(fields[0]), strings.Join(fields[1:], " ")
		if key == "host" {
			patterns := fields[1:]
			blocks = append(blocks, configBlock{patterns: patterns, values: map[string]string{}})
			for _, alias := range patterns {
				if !strings.HasPrefix(alias, "!") && !strings.ContainsAny(alias, "*?") && !seen[alias] { aliases = append(aliases, alias); seen[alias] = true }
			}
		} else {
			block := &blocks[len(blocks)-1]
			if _, exists := block.values[key]; !exists { block.values[key] = strings.Trim(value, "\"'") }
		}
	}
	return blocks, aliases
}

func hostMatches(alias string, patterns []string) bool {
	matched := false
	for _, raw := range patterns {
		negative := strings.HasPrefix(raw, "!")
		pattern := strings.TrimPrefix(raw, "!")
		ok, _ := filepath.Match(strings.ToLower(pattern), strings.ToLower(alias))
		if ok && negative { return false }
		if ok { matched = true }
	}
	return matched
}

func expandIdentity(value string) string {
	if strings.HasPrefix(value, "~/") || strings.HasPrefix(value, "~"+string(filepath.Separator)) {
		if home, err := os.UserHomeDir(); err == nil { return filepath.Join(home, value[2:]) }
	}
	return os.ExpandEnv(value)
}

func resolveSSHHost(content, alias string) sshclient.SSHHost {
	result := sshclient.SSHHost{Alias: alias, Host: alias, Port: 22}
	values := map[string]string{}
	blocks, _ := parseSSHConfig(content)
	for _, block := range blocks {
		if !hostMatches(alias, block.patterns) { continue }
		for key, value := range block.values { if _, exists := values[key]; !exists { values[key] = value } }
	}
	if value := values["hostname"]; value != "" { result.Host = value }
	result.User = values["user"]
	if result.User == "" { if current, err := user.Current(); err == nil { result.User = current.Username } }
	if value := values["port"]; value != "" { if port, err := strconv.Atoi(value); err == nil { result.Port = port } }
	result.Identity = expandIdentity(values["identityfile"])
	return result
}

func (a *App) ListSSHHosts() ([]sshclient.SSHHost, error) {
	content, err := a.GetSSHConfig()
	if err != nil { return nil, err }
	_, aliases := parseSSHConfig(content)
	hosts := make([]sshclient.SSHHost, 0, len(aliases))
	for _, alias := range aliases { hosts = append(hosts, resolveSSHHost(content, alias)) }
	return hosts, nil
}
