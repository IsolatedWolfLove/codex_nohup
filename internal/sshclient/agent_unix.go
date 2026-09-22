//go:build !windows

package sshclient

import (
	"errors"
	"net"
	"os"
	"time"
)

func dialAgent() (net.Conn, error) {
	socket := os.Getenv("SSH_AUTH_SOCK")
	if socket == "" {
		return nil, errors.New("未设置 SSH_AUTH_SOCK，请启动 SSH Agent 或改用私钥认证")
	}
	return net.DialTimeout("unix", socket, 5*time.Second)
}
