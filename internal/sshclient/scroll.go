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
	command := "tmux send-keys -X -t " + target + " cancel 2>/dev/null || true"
	if _, err := checked(execConnectionCommand(conn, command)); err != nil {
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

const paneScrollFormat = "#{pane_id}|#{history_size}|#{scroll_position}|#{pane_height}|#{pane_in_mode}"

func readPaneScrollState(conn *connection, name string) (paneScrollState, error) {
	result, err := checked(execConnectionCommand(conn, "tmux display-message -p -t "+quoteSh("="+name+":")+" "+quoteSh(paneScrollFormat)))
	if err != nil {
		return paneScrollState{}, err
	}
	return parsePaneScrollState(result.stdout)
}

func buildScrollCommand(name string, value int, relative bool) string {
	targetExpr := strconv.Itoa(max(0, value))
	if relative {
		targetExpr = fmt.Sprintf("$((cur + (%d)))", max(-500, min(500, value)))
	}
	sessionTarget := quoteSh("=" + name + ":")
	format := quoteSh(paneScrollFormat)
	return "s=$(tmux display-message -p -t " + sessionTarget + " " + format + ") || exit $?; " +
		"IFS='|' read -r pane lines offset rows mode <<EOF\n$s\nEOF\n" +
		"offset=${offset:-0}; cur=$((lines - offset)); [ \"$cur\" -lt 0 ] && cur=0; " +
		"target=" + targetExpr + "; " +
		"[ \"$target\" -lt 0 ] && target=0; [ \"$target\" -gt \"$lines\" ] && target=$lines; " +
		"if [ \"$target\" -eq \"$cur\" ]; then printf '%s\\n' \"$s\"; " +
		"elif [ \"$target\" -eq \"$lines\" ]; then " +
		"if [ \"$mode\" = 1 ]; then tmux send-keys -X -t \"$pane\" cancel || exit $?; fi; " +
		"tmux display-message -p -t \"$pane\" " + format + "; " +
		"else " +
		"if [ \"$mode\" != 1 ]; then tmux copy-mode -e -t \"$pane\" || exit $?; fi; " +
		"diff=$((cur - target)); " +
		"if [ \"$diff\" -gt 0 ]; then tmux send-keys -X -N \"$diff\" -t \"$pane\" scroll-up || exit $?; " +
		"else diff=$((-diff)); tmux send-keys -X -N \"$diff\" -t \"$pane\" scroll-down || exit $?; fi; " +
		"tmux display-message -p -t \"$pane\" " + format + "; fi"
}

func (c *Client) GetTerminalScrollState(id string) (TerminalScrollState, error) {
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
	result, err := checked(execConnectionCommand(conn, buildScrollCommand(t.name, value, relative)))
	if err != nil {
		return TerminalScrollState{}, err
	}
	updated, err := parsePaneScrollState(result.stdout)
	if err != nil {
		return TerminalScrollState{}, err
	}
	if updated.mode || updated.Position < updated.Lines {
		t.scrollPane = updated.pane
	} else {
		t.scrollPane = ""
	}
	return updated.TerminalScrollState, nil
}
