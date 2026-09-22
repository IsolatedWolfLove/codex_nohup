//go:build !windows

package main

import "fmt"

func main() { fmt.Println("nohop-agent is only needed on Windows") }
