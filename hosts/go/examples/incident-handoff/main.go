// Incident handoff — interactive terminal app with an HTML view, a Go
// controller, and TeML as the terminal runtime (same pattern as
// examples/rust-host).
//
// Run from this directory:
//
//	go run .
//
// TeML engine resolution order: explicit option → TEML_CLI →
// repo dist/cli/main.js → teml on PATH.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/fogha/teml/hosts/go/engine"
	"github.com/fogha/teml/hosts/go/protocol"
	"github.com/fogha/teml/hosts/go/screen"
	"github.com/fogha/teml/hosts/go/terminal"
)

func main() {
	if !terminal.IsTerminal() {
		fmt.Fprintln(os.Stderr, "incident-handoff needs a real terminal — run it directly, not piped.")
		os.Exit(1)
	}

	width, height, err := terminal.Size()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	viewPath := viewHTMLPath()
	session, err := engine.Spawn(engine.SpawnOptions{
		ViewPath: viewPath,
		Width:    width,
		Height:   height,
		Frames:   protocol.FrameANSI,
		Mode:     protocol.FramePatches,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer session.Close()
	fmt.Fprintln(os.Stderr, session.Engine.Diagnostics())

	firstFrame, err := session.InitialFrame()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	supportsScroll := false
	for _, cap := range firstFrame.Capabilities {
		if cap == string(protocol.CapScroll) {
			supportsScroll = true
			break
		}
	}

	buf := screen.NewBuffer(screen.PreferredANSI)
	if err := buf.Apply(firstFrame); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	raw, err := terminal.EnterRaw()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer raw.Close()
	if err := terminal.EnableMouseCapture(os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := terminal.Paint(os.Stdout, buf); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	reader := terminal.NewReader(os.Stdin)
	var done string
	for done == "" {
		cmd, err := reader.ReadCommand()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			break
		}
		if cmd == nil {
			continue
		}
		if cmd.Type == "exit" {
			break
		}
		if cmd.Type == "scroll" {
			mapped := terminal.MapScroll(cmd.ScrollRows, supportsScroll)
			cmd = &mapped
		}
		if err := session.Send(*cmd); err != nil {
			fmt.Fprintln(os.Stderr, err)
			break
		}

		for {
			ev, err := session.Next()
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				done = "Session ended unexpectedly."
				break
			}
			switch ev.Type {
			case "frame":
				if err := buf.Apply(ev); err != nil {
					fmt.Fprintln(os.Stderr, err)
					done = "Frame error."
					break
				}
				if err := terminal.Paint(os.Stdout, buf); err != nil {
					fmt.Fprintln(os.Stderr, err)
					done = "Paint error."
				}
				if done == "" {
					goto nextInput
				}
			case "click":
				switch ev.ID {
				case "cancel":
					done = "Cancelled — no incident handoff sent."
					_ = session.Send(protocol.Exit())
				case "submit":
					if err := validate(ev.Values); err != nil {
						markup, err := screenHTML(viewPath, err.Error())
						if err != nil {
							fmt.Fprintln(os.Stderr, err)
							done = "Render error."
							break
						}
						if err := session.Send(protocol.Render(markup, protocol.DocHTML)); err != nil {
							fmt.Fprintln(os.Stderr, err)
							done = "Send error."
						}
					} else {
						done = formatSuccess(ev.Values)
						_ = session.Send(protocol.Exit())
					}
				}
			case "error":
				fmt.Fprintf(os.Stderr, "\r\n[teml] %s\r\n", ev.Message)
			case "exit":
				goto finished
			}
			if done != "" {
				break
			}
		}
	nextInput:
	}
finished:
	if done != "" {
		fmt.Println(done)
	}
}

func viewHTMLPath() string {
	_, file, _, ok := runtime.Caller(0)
	if ok {
		path := filepath.Join(filepath.Dir(file), "view.html")
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return filepath.Join("examples", "incident-handoff", "view.html")
}

func validate(values map[string]string) error {
	get := func(key string) string {
		return strings.TrimSpace(values[key])
	}
	if get("service") == "" {
		return fmt.Errorf("Affected service is required.")
	}
	if get("summary") == "" {
		return fmt.Errorf("Operator summary is required.")
	}
	return nil
}

func formatSuccess(values map[string]string) string {
	paged := "no"
	if values["page"] == "true" {
		paged = "yes"
	}
	return fmt.Sprintf(
		"Incident handoff sent!\n  service:  %s\n  severity: %s\n  summary:  %s\n  paged:    %s",
		values["service"],
		values["severity"],
		strings.ReplaceAll(values["summary"], "\n", " / "),
		paged,
	)
}

func screenHTML(viewPath, message string) (string, error) {
	base, err := os.ReadFile(viewPath)
	if err != nil {
		return "", err
	}
	return strings.Replace(string(base), "</h2>", fmt.Sprintf("</h2>\n<div class=\"alert alert-danger\">%s</div>", message), 1), nil
}
