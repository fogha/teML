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

	"github.com/fogha/teml/hosts/go/app"
	"github.com/fogha/teml/hosts/go/protocol"
)

func main() {
	viewPath := viewHTMLPath()
	opts, err := app.ForTerminal(viewPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	var outcome string
	_, err = app.Run(opts, app.Handlers{
		OnClick: func(id string, values app.Values, ctx *app.Context) {
			switch id {
			case "cancel":
				outcome = "Cancelled — no incident handoff sent."
				ctx.Exit()
			case "submit":
				if err := validate(values); err != nil {
					markup, readErr := screenHTML(viewPath, err.Error())
					if readErr != nil {
						fmt.Fprintln(os.Stderr, readErr)
						outcome = "Render error."
						ctx.Exit()
						return
					}
					ctx.Render(markup, protocol.DocHTML)
				} else {
					outcome = formatSuccess(values)
					ctx.Exit()
				}
			}
		},
		OnError: func(message string, _ *app.Context) {
			fmt.Fprintf(os.Stderr, "\r\n[teml] %s\r\n", message)
		},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if outcome != "" {
		fmt.Println(outcome)
	} else {
		fmt.Println("Session ended without submission.")
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
