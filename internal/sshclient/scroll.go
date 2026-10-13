package sshclient

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type TerminalScrollState struct {
	Lines    int `json:"lines"`
	Position int `json:"position"`
	Rows     int `json:"rows"`
}

type paneScrollState struct {
	TerminalScrollState
	pane   string
	offset int
	mode   bool
}

// Called with writeMu held. Escape or tmux bindings may already have left
// copy mode, so cancellation must not make the next keystroke fail.
func (t *terminal) leaveHistory(conn *connection) error {
	if t.scrollPane == "" || conn == nil {
		return nil
	}
	target := quoteSh(t.scrollPane)
	command := "if [ \"$(tmux display-message -p -t " + target + " '#{pane_in_mode}')\" = 1 ]; then tmux send-keys -X -t " + target + " cancel; fi"
	if _, err := checked(execCommand(conn.client, command)); err != nil {
		return err
	}
	t.scrollPane = ""
	return nil
}

func parsePaneScrollState(output string) (paneScrollState, error) {
	fields := strings.Split(strings.TrimSpace(output), "|")
	if len(fields) != 5 || !strings.HasPrefix(fields[0], "%") {
		return paneScrollState{}, errors.New("无法读取 tmux 滚动位置")
	}
	values := make([]int, 4)
	for i, field := range fields[1:] {
		if field == "" && i == 1 {
			continue
		}
		value, err := strconv.Atoi(field)
		if err != nil || value < 0 {
			return paneScrollState{}, errors.New("无效的 tmux 滚动位置")
		}
		values[i] = value
	}
	return paneScrollState{TerminalScrollState: TerminalScrollState{Lines: values[0], Position: max(0, values[0]-values[1]), Rows: values[2]}, pane: fields[0], offset: values[1], mode: values[3] != 0}, nil
}

func readPaneScrollState(conn *connection, name string) (paneScrollState, error) {
	result, err := checked(execCommand(conn.client, "tmux display-message -p -t "+quoteSh("="+name+":")+" "+quoteSh("#{pane_id}|#{history_size}|#{scroll_position}|#{pane_height}|#{pane_in_mode}")))
	if err != nil {
		return paneScrollState{}, err
	}
	return parsePaneScrollState(result.stdout)
}

func (c *Client) GetTerminalScrollState(id string) (TerminalScrollState, error) {
	c.op.Lock()
	defer c.op.Unlock()
	t := c.getTerminal(id)
	if t == nil {
		return TerminalScrollState{}, errors.New("终端已关闭")
	}
	conn, err := c.current()
	if err != nil {
		return TerminalScrollState{}, err
	}
	if conn.info.Backend != "tmux" {
		return TerminalScrollState{}, errors.New("当前后端没有远端滚动历史")
	}
	state, err := readPaneScrollState(conn, t.name)
	return state.TerminalScrollState, err
}

func (c *Client) ScrollTerminal(id string, value int, relative bool) (TerminalScrollState, error) {
	c.op.Lock()
	defer c.op.Unlock()
	t := c.getTerminal(id)
	if t == nil {
		return TerminalScrollState{}, errors.New("终端已关闭")
	}
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	conn, err := c.current()
	if err != nil {
		return TerminalScrollState{}, err
	}
	if conn.info.Backend != "tmux" {
		return TerminalScrollState{}, errors.New("当前后端没有远端滚动历史")
	}
	state, err := readPaneScrollState(conn, t.name)
	if err != nil {
		return TerminalScrollState{}, err
	}
	position := value
	if relative {
		position = state.Position + max(-500, min(500, value))
	}
	position = max(0, min(state.Lines, position))
	if position == state.Position {
		return state.TerminalScrollState, nil
	}
	target := quoteSh(state.pane)
	command := ""
	if position == state.Lines {
		if state.mode {
			command = "tmux send-keys -X -t " + target + " cancel"
		}
	} else {
		if !state.mode {
			command = "tmux copy-mode -e -t " + target + " && "
		}
		amount := state.Position - position
		direction := "scroll-up"
		if amount < 0 {
			amount = -amount
			direction = "scroll-down"
		}
		command += fmt.Sprintf("tmux send-keys -X -N %d -t %s %s", amount, target, direction)
	}
	if command != "" {
		if _, err := checked(execCommand(conn.client, command)); err != nil {
			return TerminalScrollState{}, err
		}
	}
	if position < state.Lines {
		t.scrollPane = state.pane
	} else {
		t.scrollPane = ""
	}
	updated, err := readPaneScrollState(conn, t.name)
	return updated.TerminalScrollState, err
}
