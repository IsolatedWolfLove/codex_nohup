package sshclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type PortForwardInput struct {
	Direction  string `json:"direction"`
	ListenHost string `json:"listenHost"`
	ListenPort int    `json:"listenPort"`
	TargetHost string `json:"targetHost"`
	TargetPort int    `json:"targetPort"`
}

type PortForward struct {
	PortForwardInput
	ID        string `json:"id"`
	LastError string `json:"lastError"`
}

type portForward struct {
	mu       sync.Mutex
	info     PortForward
	listener net.Listener
	sockets  map[net.Conn]struct{}
	ctx      context.Context
	cancel   context.CancelFunc
}

func (f *portForward) close() {
	f.cancel()
	_ = f.listener.Close()
	f.mu.Lock()
	defer f.mu.Unlock()
	for socket := range f.sockets {
		_ = socket.Close()
	}
}

func (f *portForward) track(socket net.Conn) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.ctx.Err() != nil {
		_ = socket.Close()
		return false
	}
	f.sockets[socket] = struct{}{}
	return true
}

func (f *portForward) relay(source net.Conn, dial func(context.Context) (net.Conn, error)) {
	defer func() {
		_ = source.Close()
		f.mu.Lock()
		delete(f.sockets, source)
		f.mu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(f.ctx, 20*time.Second)
	defer cancel()
	target, err := dial(ctx)
	if err != nil {
		f.mu.Lock()
		f.info.LastError = fmt.Sprintf("连接目标失败：%v", err)
		f.mu.Unlock()
		return
	}
	if !f.track(target) {
		return
	}
	defer func() {
		_ = target.Close()
		f.mu.Lock()
		delete(f.sockets, target)
		f.mu.Unlock()
	}()
	// Preserve TCP half-close so request/response protocols can finish after EOF.
	done := make(chan struct{})
	copyTo := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		if half, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = half.CloseWrite()
		} else {
			_ = dst.Close()
		}
	}
	go func() { copyTo(target, source); close(done) }()
	copyTo(source, target)
	<-done
}

func (c *Client) StartPortForward(input PortForwardInput) (PortForward, error) {
	c.op.Lock()
	defer c.op.Unlock()
	if input.Direction != "local" && input.Direction != "remote" {
		return PortForward{}, errors.New("请选择本地或远程转发")
	}
	if input.ListenPort < 1 || input.ListenPort > 65535 || input.TargetPort < 1 || input.TargetPort > 65535 {
		return PortForward{}, errors.New("端口必须在 1–65535 之间")
	}
	input.ListenHost = strings.TrimSpace(input.ListenHost)
	input.TargetHost = strings.TrimSpace(input.TargetHost)
	if input.ListenHost == "" {
		input.ListenHost = "127.0.0.1"
	}
	if input.TargetHost == "" {
		return PortForward{}, errors.New("请输入目标主机")
	}
	conn, err := c.current()
	if err != nil {
		return PortForward{}, err
	}
	if conn.local {
		return PortForward{}, errors.New("端口转发需要选择 SSH 服务器")
	}
	address := net.JoinHostPort(input.ListenHost, strconv.Itoa(input.ListenPort))
	var listener net.Listener
	if input.Direction == "local" {
		listener, err = net.Listen("tcp", address)
	} else {
		listener, err = conn.client.Listen("tcp", address)
	}
	if err != nil {
		return PortForward{}, fmt.Errorf("无法监听 %s：%w", address, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	info := PortForward{PortForwardInput: input, ID: uuid.NewString()}
	f := &portForward{info: info, listener: listener, sockets: map[net.Conn]struct{}{}, ctx: ctx, cancel: cancel}
	c.mu.Lock()
	if c.conn != conn {
		c.mu.Unlock()
		f.close()
		return PortForward{}, errors.New("SSH 连接已断开")
	}
	if c.forwards == nil {
		c.forwards = map[string]*portForward{}
	}
	c.forwards[info.ID] = f
	c.mu.Unlock()
	go func() {
		select {
		case <-conn.done:
		case <-ctx.Done():
		}
		_ = c.StopPortForward(info.ID)
	}()
	go func() {
		defer c.StopPortForward(info.ID)
		target := net.JoinHostPort(input.TargetHost, strconv.Itoa(input.TargetPort))
		for {
			socket, err := listener.Accept()
			if err != nil {
				return
			}
			if !f.track(socket) {
				return
			}
			go f.relay(socket, func(ctx context.Context) (net.Conn, error) {
				if input.Direction == "local" {
					return conn.client.DialContext(ctx, "tcp", target)
				}
				return (&net.Dialer{}).DialContext(ctx, "tcp", target)
			})
		}
	}()
	return info, nil
}

func (c *Client) ListPortForwards() []PortForward {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := make([]PortForward, 0, len(c.forwards))
	for _, f := range c.forwards {
		f.mu.Lock()
		result = append(result, f.info)
		f.mu.Unlock()
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func (c *Client) StopPortForward(id string) error {
	c.mu.Lock()
	f := c.forwards[id]
	delete(c.forwards, id)
	c.mu.Unlock()
	if f != nil {
		f.close()
	}
	return nil
}
