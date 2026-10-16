package main

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
)

// Tokenize only: pasted commands are never executed by a shell.
func sshCommandWords(command string) ([]string, error) {
	var words []string
	var word strings.Builder
	var quote rune
	started := false
	chars := []rune(command)
	for i := 0; i < len(chars); i++ {
		c := chars[i]
		if c < 32 && c != '\t' {
			return nil, fmt.Errorf("SSH 命令必须为单行")
		}
		if c == '\\' && quote != '\'' && i+1 < len(chars) {
			next := chars[i+1]
			if next == '"' || next == '\'' || next == ' ' || next == '\\' {
				word.WriteRune(next)
				i++
				started = true
				continue
			}
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				word.WriteRune(c)
			}
			started = true
			continue
		}
		if c == '"' || c == '\'' {
			quote = c
			started = true
			continue
		}
		if c == ' ' || c == '\t' {
			if started {
				words = append(words, word.String())
				word.Reset()
				started = false
			}
		} else {
			word.WriteRune(c)
			started = true
		}
	}
	if quote != 0 {
		return nil, fmt.Errorf("SSH 命令中的引号未闭合")
	}
	if started {
		words = append(words, word.String())
	}
	return words, nil
}

var sshAliasPattern = regexp.MustCompile(`^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$`)

func addSSHCommand(content, alias, command string) (string, error) {
	alias = strings.TrimSpace(alias)
	if !sshAliasPattern.MatchString(alias) {
		return "", fmt.Errorf("别名只能包含文字、数字、下划线、点和连字符，且不能以点或连字符开头")
	}
	_, aliases := parseSSHConfig(content)
	for _, existing := range aliases {
		if strings.EqualFold(existing, alias) {
			return "", fmt.Errorf("别名 %s 已存在，请使用其他别名或编辑配置", alias)
		}
	}
	words, err := sshCommandWords(strings.TrimSpace(command))
	if err != nil {
		return "", err
	}
	if len(words) < 2 || (words[0] != "ssh" && words[0] != "ssh.exe") {
		return "", fmt.Errorf("请输入 ssh user@host 形式的命令")
	}
	values := map[string]string{}
	var identities []string
	destination := ""
	for i := 1; i < len(words); i++ {
		arg := words[i]
		if strings.HasPrefix(arg, "-") {
			if len(arg) < 2 {
				return "", fmt.Errorf("无效的 SSH 参数")
			}
			option := arg[:2]
			if option != "-p" && option != "-l" && option != "-i" && option != "-J" && option != "-o" {
				return "", fmt.Errorf("暂不支持参数 %s；支持 -p、-l、-i、-J、-o", arg)
			}
			value := arg[2:]
			if value == "" {
				i++
				if i >= len(words) {
					return "", fmt.Errorf("参数 %s 缺少值", option)
				}
				value = words[i]
			}
			key := map[string]string{"-p": "port", "-l": "user", "-i": "identityfile", "-J": "proxyjump"}[option]
			if option == "-o" {
				fields := strings.SplitN(value, "=", 2)
				if len(fields) != 2 {
					fields = strings.SplitN(value, " ", 2)
				}
				if len(fields) != 2 {
					return "", fmt.Errorf("-o 请使用 Key=Value 格式")
				}
				key, value = strings.ToLower(fields[0]), strings.TrimSpace(fields[1])
				switch key {
				case "hostname", "user", "port", "identityfile", "proxyjump":
				default:
					return "", fmt.Errorf("暂不支持 SSH 选项 %s", fields[0])
				}
			}
			if value == "" || strings.ContainsAny(value, "\r\n\x00\"#") {
				return "", fmt.Errorf("SSH 参数值为空或含不支持的字符")
			}
			if key == "identityfile" {
				identities = append(identities, value)
			} else if _, ok := values[key]; !ok {
				values[key] = value
			}
		} else {
			if destination != "" {
				return "", fmt.Errorf("只支持连接命令，请移除远端命令或多余参数")
			}
			destination = arg
		}
	}
	if destination == "" {
		return "", fmt.Errorf("SSH 命令缺少主机地址")
	}
	if at := strings.LastIndex(destination, "@"); at >= 0 {
		if values["user"] == "" {
			values["user"] = destination[:at]
		}
		destination = destination[at+1:]
	}
	destination = strings.TrimPrefix(strings.TrimSuffix(destination, "]"), "[")
	if destination == "" || strings.ContainsAny(destination, " /\\\t\"'#;=$`") {
		return "", fmt.Errorf("无效的主机地址")
	}
	if strings.Contains(destination, ":") && net.ParseIP(destination) == nil {
		return "", fmt.Errorf("端口请通过 -p 指定")
	}
	inherited := resolveSSHHost(content, destination)
	if values["hostname"] == "" {
		values["hostname"] = inherited.Host
	}
	if values["user"] == "" {
		values["user"] = inherited.User
	}
	if values["port"] == "" {
		values["port"] = strconv.Itoa(inherited.Port)
	}
	port, err := strconv.Atoi(values["port"])
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("端口必须在 1–65535 之间")
	}
	if values["proxyjump"] == "" {
		values["proxyjump"] = inherited.ProxyJump
	}
	if strings.Contains(values["proxyjump"], ",") {
		return "", fmt.Errorf("目前仅支持一台跳板机")
	}
	if len(identities) == 0 {
		identities = inherited.Identities
	}
	var block strings.Builder
	fmt.Fprintf(&block, "Host %s\n", alias)
	for _, pair := range [][2]string{{"hostname", "HostName"}, {"user", "User"}, {"port", "Port"}, {"proxyjump", "ProxyJump"}} {
		value := values[pair[0]]
		if value != "" {
			if strings.ContainsAny(value, "\r\n\x00\"#") {
				return "", fmt.Errorf("配置值含不支持的字符")
			}
			fmt.Fprintf(&block, "  %s \"%s\"\n", pair[1], value)
		}
	}
	for _, path := range identities {
		if strings.ContainsAny(path, "\r\n\x00\"#") {
			return "", fmt.Errorf("密钥路径含不支持的字符")
		}
		fmt.Fprintf(&block, "  IdentityFile \"%s\"\n", path)
	}
	// Prepend so explicit command options win over wildcard defaults. Restore
	// global scope for any directives preceding the original first Host block.
	if strings.TrimSpace(content) != "" {
		block.WriteString("\nHost *\n")
		block.WriteString(content)
	}
	return block.String(), nil
}

func (a *App) AddSSHHost(alias, command string) error {
	content, err := a.GetSSHConfig()
	if err != nil {
		return err
	}
	updated, err := addSSHCommand(content, alias, command)
	if err != nil {
		return err
	}
	return a.SaveSSHConfig(updated)
}
