//go:build (!linux && !windows) || android

package sshclient

import "errors"

func startLocalProcess(_, _, _ string, _, _ int) (localProcess, error) {
	return nil, errors.New("当前平台暂不支持本机终端")
}
