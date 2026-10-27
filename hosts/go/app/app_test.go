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

// fakeEngineOptions points the session at the scripted fake engine. The view
// name is the scenario selector; the fake ignores the path's existence.
func fakeEngineOptions(t *testing.T, scenario string) app.RunOptions {
	t.Helper()
	return app.RunOptions{
		ResolveOptions: engine.ResolveOptions{
			ExplicitPath: filepath.Join(repoRoot(t), "fixtures", "engine", "fake-engine.mjs"),
		},
		ViewPath: scenario,
		Width:    60,
		NoColor:  true,
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

// A rejected command answers with `error` and no frame, so the driver must
// treat the error as that command's completion; waiting for a frame blocks.
func TestEngineErrorCompletesTheCommandInsteadOfBlocking(t *testing.T) {
	var errors []string

	values, err := app.RunHeadless(testOptions(t), app.Handlers{
		OnChange: func(_, _ string, ctx *app.Context) {
			// The engine rejects an unknown format while decoding, with `error`
			// and no frame.
			ctx.Render("<h2>x</h2>", protocol.DocFormat("bogus"))
		},
		OnError: func(message string, ctx *app.Context) {
			errors = append(errors, message)
			ctx.Exit()
		},
	}, app.TypingCommands("X"), 60, 20)
	if err != nil {
		t.Fatalf("driver runs against a built engine or TEML_CLI: %v", err)
	}
	if len(errors) == 0 {
		t.Fatal("expected the engine to reject the render")
	}
	if values == nil {
		t.Fatal("values should be a map, not nil")
	}
}

// An engine newer than this host may answer a command with an event type the
// host does not know and no frame. The loop must surface the event and
// complete the command; waiting for a frame would hang forever.
func TestUnknownEventCompletesTheCommandAndSurfaces(t *testing.T) {
	var errors []string

	values, err := app.RunHeadless(fakeEngineOptions(t, "unknown-event"), app.Handlers{
		OnError: func(message string, ctx *app.Context) {
			errors = append(errors, message)
			ctx.Exit()
		},
	}, app.TypingCommands("x"), 60, 20)
	if err != nil {
		t.Fatalf("fake engine session: %v", err)
	}
	if len(errors) != 1 || errors[0] != "unrecognized session event 'future-thing'" {
		t.Fatalf("errors = %v, want the surfaced unknown event type", errors)
	}
	if len(values) != 0 {
		t.Fatalf("values = %v", values)
	}
}

func TestSubmitEventDispatchesOnSubmitWithFormAndValues(t *testing.T) {
	var submits []struct {
		form   string
		values app.Values
	}

	values, err := app.RunHeadless(fakeEngineOptions(t, "submit"), app.Handlers{
		OnSubmit: func(form string, snapshot app.Values, ctx *app.Context) {
			submits = append(submits, struct {
				form   string
				values app.Values
			}{form, snapshot})
			ctx.Exit()
		},
	}, app.TypingCommands("x"), 60, 20)
	if err != nil {
		t.Fatalf("fake engine session: %v", err)
	}
	if len(submits) != 1 {
		t.Fatalf("submits = %v, want exactly one dispatch", submits)
	}
	if submits[0].form != "deploy" {
		t.Fatalf("form = %q", submits[0].form)
	}
	if submits[0].values["env"] != "prod" {
		t.Fatalf("submit values = %v", submits[0].values)
	}
	// The final values are the submit snapshot.
	if values["env"] != "prod" {
		t.Fatalf("final values = %v", values)
	}
}
