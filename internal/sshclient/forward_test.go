package sshclient

import (
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// A real SSH transport exercises both direct-tcpip and forwarded-tcpip channels.
func testForwardClient(t *testing.T) *Client {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer(t))
	done := make(chan struct{})
	go func() {
		defer close(done)
		raw, err := listener.Accept()
		if err != nil {
			return
		}
		server, channels, requests, err := ssh.NewServerConn(raw, config)
		if err != nil {
			raw.Close()
			return
		}
		defer server.Close()
		var mu sync.Mutex
		listeners := map[string]net.Listener{}
		defer func() {
			mu.Lock()
			defer mu.Unlock()
			for _, l := range listeners {
				l.Close()
			}
		}()
		go func() {
			for request := range requests {
				var payload struct {
					Host string
					Port uint32
				}
				if err := ssh.Unmarshal(request.Payload, &payload); err != nil {
					request.Reply(false, nil)
					continue
				}
				address := net.JoinHostPort(payload.Host, strconv.Itoa(int(payload.Port)))
				switch request.Type {
				case "tcpip-forward":
					l, err := net.Listen("tcp", address)
					if err != nil {
						request.Reply(false, nil)
						continue
					}
					mu.Lock()
					listeners[address] = l
					mu.Unlock()
					request.Reply(true, nil)
					go func() {
						for {
							socket, err := l.Accept()
							if err != nil {
								return
							}
							go func() {
								defer socket.Close()
								origin := socket.RemoteAddr().(*net.TCPAddr)
								data := ssh.Marshal(struct {
									Host       string
									Port       uint32
									Origin     string
									OriginPort uint32
								}{payload.Host, payload.Port, origin.IP.String(), uint32(origin.Port)})
								channel, requests, err := server.OpenChannel("forwarded-tcpip", data)
								if err != nil {
									return
								}
								go ssh.DiscardRequests(requests)
								testForwardRelay(socket, channel)
							}()
						}
					}()
				case "cancel-tcpip-forward":
					mu.Lock()
					l := listeners[address]
					delete(listeners, address)
					mu.Unlock()
					if l != nil {
						l.Close()
					}
					request.Reply(true, nil)
				default:
					request.Reply(false, nil)
				}
			}
		}()
		for incoming := range channels {
			if incoming.ChannelType() != "direct-tcpip" {
				incoming.Reject(ssh.UnknownChannelType, "unsupported")
				continue
			}
			go func() {
				var target struct {
					Host       string
					Port       uint32
					Origin     string
					OriginPort uint32
				}
				if ssh.Unmarshal(incoming.ExtraData(), &target) != nil {
					incoming.Reject(ssh.ConnectionFailed, "invalid target")
					return
				}
				socket, err := net.Dial("tcp", net.JoinHostPort(target.Host, strconv.Itoa(int(target.Port))))
				if err != nil {
					incoming.Reject(ssh.ConnectionFailed, err.Error())
					return
				}
				defer socket.Close()
				channel, requests, err := incoming.Accept()
				if err != nil {
					return
				}
				go ssh.DiscardRequests(requests)
				testForwardRelay(socket, channel)
			}()
		}
	}()
	transport, err := ssh.Dial("tcp", listener.Addr().String(), &ssh.ClientConfig{User: "test", HostKeyCallback: ssh.InsecureIgnoreHostKey()})
	if err != nil {
		t.Fatal(err)
	}
	c := New(func(TerminalEvent) {}, nil, nil, nil, nil)
	c.conn = &connection{client: transport, done: make(chan struct{})}
	go c.monitor(c.conn)
	t.Cleanup(func() { c.Disconnect(); <-done })
	return c
}

func testForwardRelay(socket net.Conn, channel ssh.Channel) {
	defer channel.Close()
	done := make(chan struct{})
	go func() { io.Copy(channel, socket); channel.CloseWrite(); close(done) }()
	io.Copy(socket, channel)
	if tcp, ok := socket.(*net.TCPConn); ok {
		tcp.CloseWrite()
	}
	<-done
}

func freeForwardPort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return port
}

func eventuallyForward(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for forward cleanup")
}

func TestPortForwardTransferAndStop(t *testing.T) {
	for _, direction := range []string{"local", "remote"} {
		t.Run(direction, func(t *testing.T) {
			c := testForwardClient(t)
			target, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer target.Close()
			go func() {
				for {
					socket, err := target.Accept()
					if err != nil {
						return
					}
					go func() { defer socket.Close(); io.Copy(socket, socket) }()
				}
			}()
			input := PortForwardInput{Direction: direction, ListenHost: "127.0.0.1", ListenPort: freeForwardPort(t), TargetHost: "127.0.0.1", TargetPort: target.Addr().(*net.TCPAddr).Port}
			forward, err := c.StartPortForward(input)
			if err != nil {
				t.Fatal(err)
			}
			if len(c.ListPortForwards()) != 1 {
				t.Fatal("forward missing")
			}
			if _, err := c.StartPortForward(input); err == nil {
				t.Fatal("duplicate listener accepted")
			}
			socket, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", input.ListenPort), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer socket.Close()
			socket.SetDeadline(time.Now().Add(3 * time.Second))
			payload := "端口转发 works"
			if _, err := io.WriteString(socket, payload); err != nil {
				t.Fatal(err)
			}
			result := make([]byte, len(payload))
			if _, err := io.ReadFull(socket, result); err != nil || string(result) != payload {
				t.Fatal(string(result), err)
			}

			// Closing only the write side must still allow the full response to arrive.
			half, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", input.ListenPort), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			half.SetDeadline(time.Now().Add(3 * time.Second))
			io.WriteString(half, payload)
			half.(*net.TCPConn).CloseWrite()
			response, err := io.ReadAll(half)
			half.Close()
			if err != nil || string(response) != payload {
				t.Fatal("half-close lost response", string(response), err)
			}
			if err := c.StopPortForward(forward.ID); err != nil {
				t.Fatal(err)
			}
			if len(c.ListPortForwards()) != 0 {
				t.Fatal("stopped forward remains")
			}
			if _, err := socket.Read(make([]byte, 1)); err == nil {
				t.Fatal("active socket remains open")
			} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
				t.Fatal("active socket was not closed")
			}
			replacement, err := c.StartPortForward(input)
			if err != nil {
				t.Fatal("listener not released:", err)
			}
			c.mu.Lock()
			transport := c.conn.client
			c.mu.Unlock()
			transport.Close()
			eventuallyForward(t, func() bool { return len(c.ListPortForwards()) == 0 })
			c.StopPortForward(replacement.ID)
		})
	}
}

func TestPortForwardValidationAndDisconnect(t *testing.T) {
	c := testForwardClient(t)
	valid := PortForwardInput{Direction: "local", ListenPort: freeForwardPort(t), TargetHost: "localhost", TargetPort: 80}
	for _, mutate := range []func(*PortForwardInput){
		func(i *PortForwardInput) { i.Direction = "invalid" },
		func(i *PortForwardInput) { i.ListenPort = 0 },
		func(i *PortForwardInput) { i.TargetPort = 65536 },
		func(i *PortForwardInput) { i.TargetHost = " " },
	} {
		invalid := valid
		mutate(&invalid)
		if _, err := c.StartPortForward(invalid); err == nil {
			t.Fatal("invalid input accepted", invalid)
		}
	}
	forward, err := c.StartPortForward(valid)
	if err != nil {
		t.Fatal(err)
	}
	if forward.ListenHost != "127.0.0.1" {
		t.Fatal("unsafe default bind")
	}
	c.Disconnect()
	if len(c.ListPortForwards()) != 0 {
		t.Fatal("disconnect retained forwards")
	}
	l, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(valid.ListenPort)))
	if err != nil {
		t.Fatal("disconnect retained listener:", err)
	}
	l.Close()
	if _, err := c.StartPortForward(valid); err == nil {
		t.Fatal("forward started while disconnected")
	}
}
