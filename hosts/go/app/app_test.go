package app_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/fogha/teml/hosts/go/app"
	"github.com/fogha/teml/hosts/go/engine"
	"github.com/fogha/teml/hosts/go/protocol"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

func testViewPath(t *testing.T) string {
	t.Helper()
	candidates := []string{
		filepath.Join(repoRoot(t), "examples", "incident-handoff", "view.html"),
		filepath.Join(repoRoot(t), "examples", "rust-host", "view.html"),
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	t.Fatal("view.html not found under examples/incident-handoff or examples/rust-host")
	return ""
}

func requireBuiltEngine(t *testing.T) engine.ResolveOptions {
	t.Helper()
	if cli := os.Getenv("TEML_CLI"); cli != "" {
		if _, err := os.Stat(cli); err != nil {
			t.Fatalf("TEML_CLI points to missing file: %s", cli)
		}
		return engine.ResolveOptions{ExplicitPath: cli}
	}
	packageCLI := filepath.Join(repoRoot(t), "dist", "cli", "main.js")
	if _, err := os.Stat(packageCLI); err != nil {
		t.Fatal("build the repository CLI first or set TEML_CLI")
	}
	return engine.ResolveOptions{PackagePath: packageCLI}
}

func testOptions(t *testing.T) app.RunOptions {
	t.Helper()
	return app.RunOptions{
		ResolveOptions: requireBuiltEngine(t),
		ViewPath:       testViewPath(t),
		Width:          60,
		NoColor:        true,
	}
}

func TestDispatchesChangesDeliversQueuedRequestsAndExitsWithValues(t *testing.T) {
	var changes [][2]string
	var errors []string

	values, err := app.RunHeadless(testOptions(t), app.Handlers{
		OnChange: func(id, value string, ctx *app.Context) {
			changes = append(changes, [2]string{id, value})
			if len(changes) == 1 {
				ctx.Render(
					"<h2>Second screen</h2>\n<label for=\"other\">Other</label>\n<input id=\"other\">",
					protocol.DocHTML,
				)
			} else {
				ctx.Exit()
			}
		},
		OnError: func(message string, _ *app.Context) {
			errors = append(errors, message)
		},
	}, app.TypingCommands("XY"), 60, 20)
	if err != nil {
		t.Fatalf("driver runs against a built engine or TEML_CLI: %v", err)
	}

	if len(errors) != 0 {
		t.Fatalf("errors: %v", errors)
	}
	if len(changes) != 2 {
		t.Fatalf("changes = %v", changes)
	}
	if changes[0][0] != "service" {
		t.Fatalf("first change id = %q", changes[0][0])
	}
	if changes[1] != [2]string{"other", "Y"} {
		t.Fatalf("second change = %v", changes[1])
	}
	if values["other"] != "Y" {
		t.Fatalf("values = %v", values)
	}
}

func TestCtrlCEndsTheSessionWithoutAHandler(t *testing.T) {
	values, err := app.RunHeadless(testOptions(t), app.Handlers{}, app.NewScriptedCommands(protocol.Exit()), 60, 20)
	if err != nil {
		t.Fatalf("Ctrl+C is a clean end of session: %v", err)
	}
	if len(values) != 0 {
		t.Fatalf("values = %v", values)
	}
}
