package engine_test

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/fogha/teml/hosts/go/engine"
	"github.com/fogha/teml/hosts/go/protocol"
	"github.com/fogha/teml/hosts/go/screen"
)

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

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
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

func spawnSessionWithView(t *testing.T, viewPath string) *engine.Session {
	t.Helper()
	resolve := requireBuiltEngine(t)
	session, err := engine.Spawn(engine.SpawnOptions{
		ResolveOptions: resolve,
		ViewPath:       viewPath,
		Width:          60,
		NoColor:        true,
	})
	if err != nil {
		t.Fatalf("spawn session: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func spawnTestSession(t *testing.T) *engine.Session {
	return spawnSessionWithView(t, testViewPath(t))
}

func TestResolveMissingEngineFails(t *testing.T) {
	t.Setenv("TEML_CLI", "")
	_, err := engine.Resolve(engine.ResolveOptions{
		ExplicitPath: "/nonexistent/teml-cli.js",
	})
	if err == nil {
		t.Fatal("expected error for missing explicit engine")
	}
	_, err = engine.Resolve(engine.ResolveOptions{
		PackagePath: "/nonexistent/package/main.js",
	})
	if err == nil {
		t.Fatal("expected error when no engine is available")
	}
}

func TestResolveRecordsVersionDiagnostics(t *testing.T) {
	resolve := requireBuiltEngine(t)
	eng, err := engine.Resolve(resolve)
	if err != nil {
		t.Fatal(err)
	}
	if eng.Source == "" {
		t.Fatal("expected non-empty source")
	}
	diag := eng.Diagnostics()
	if !strings.Contains(diag, "source=") || !strings.Contains(diag, "version=") {
		t.Fatalf("diagnostics = %q", diag)
	}
}

func TestHTMLIncidentHandoffSessionEndToEnd(t *testing.T) {
	s := spawnTestSession(t)

	ev, err := s.Next()
	if err != nil {
		t.Fatal(err)
	}
	if ev.Type != "frame" || ev.FocusedIDString() != "service" {
		t.Fatalf("initial frame = %+v", ev)
	}
	if ev.Plain == nil || !strings.Contains(*ev.Plain, "Incident handoff") {
		t.Fatal("expected incident handoff title")
	}

	if err := s.Send(protocol.Char("payments")); err != nil {
		t.Fatal(err)
	}
	ev, err = s.Next()
	if err != nil || ev.Type != "change" || ev.ID != "service" || ev.Value != "payments" {
		t.Fatalf("change event = %+v err=%v", ev, err)
	}
	if frame, err := s.Next(); err != nil || frame.Type != "frame" {
		t.Fatalf("frame after change: %+v err=%v", frame, err)
	}

	if err := s.Send(protocol.Key(protocol.KeyTab, nil)); err != nil {
		t.Fatal(err)
	}
	if ev, err = s.Next(); err != nil || ev.FocusedIDString() != "severity" {
		t.Fatalf("tab focus: %+v err=%v", ev, err)
	}
	if err := s.Send(protocol.Key(protocol.KeyRight, nil)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.NextFrame(); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Key(protocol.KeyEnter, nil)); err != nil {
		t.Fatal(err)
	}
	ev, err = s.Next()
	if err != nil || ev.Type != "change" || ev.ID != "severity" || ev.Value != "sev2" {
		t.Fatalf("severity change: %+v err=%v", ev, err)
	}
	if _, err = s.NextFrame(); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Key(protocol.KeyTab, nil)); err != nil {
		t.Fatal(err)
	}
	if ev, err = s.Next(); err != nil || ev.FocusedIDString() != "summary" {
		t.Fatalf("summary focus: %+v err=%v", ev, err)
	}
	if err := s.Send(protocol.Char("Elevated latency\nRollback started")); err != nil {
		t.Fatal(err)
	}
	ev, err = s.Next()
	if err != nil || ev.Type != "change" || ev.ID != "summary" {
		t.Fatalf("summary change: %+v err=%v", ev, err)
	}
	if _, err = s.NextFrame(); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Key(protocol.KeyEnter, &protocol.KeyModifiers{Ctrl: true})); err != nil {
		t.Fatal(err)
	}
	if ev, err = s.Next(); err != nil || ev.FocusedIDString() != "telemetry" {
		t.Fatalf("telemetry focus: %+v err=%v", ev, err)
	}

	if err := s.Send(protocol.Scroll(2)); err != nil {
		t.Fatal(err)
	}
	ev, err = s.NextFrame()
	if err != nil || len(ev.ScrollRegions) == 0 || ev.ScrollRegions[0].ID != "telemetry" || ev.ScrollRegions[0].Offset != 2 {
		t.Fatalf("scroll frame: %+v err=%v", ev, err)
	}

	if err := s.Send(protocol.Key(protocol.KeyTab, nil)); err != nil {
		t.Fatal(err)
	}
	if ev, err = s.Next(); err != nil || ev.FocusedIDString() != "page" {
		t.Fatalf("page focus: %+v err=%v", ev, err)
	}
	if err := s.Send(protocol.Key(protocol.KeyEnter, nil)); err != nil {
		t.Fatal(err)
	}
	ev, err = s.Next()
	if err != nil || ev.Type != "toggle" || ev.ID != "page" || !ev.Checked {
		t.Fatalf("toggle: %+v err=%v", ev, err)
	}
	if _, err = s.NextFrame(); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Key(protocol.KeyTab, nil)); err != nil {
		t.Fatal(err)
	}
	if ev, err = s.Next(); err != nil || ev.FocusedIDString() != "submit" {
		t.Fatalf("submit focus: %+v err=%v", ev, err)
	}
	if err := s.Send(protocol.Key(protocol.KeyEnter, nil)); err != nil {
		t.Fatal(err)
	}
	ev, err = s.Next()
	if err != nil || ev.Type != "click" || ev.ID != "submit" {
		t.Fatalf("click: %+v err=%v", ev, err)
	}
	if ev.Values["service"] != "payments" || ev.Values["severity"] != "sev2" ||
		ev.Values["summary"] != "Elevated latency\nRollback started" ||
		ev.Values["page"] != "true" {
		t.Fatalf("click values = %+v", ev.Values)
	}
	if _, ok := ev.Values["telemetry"]; ok {
		t.Fatalf("telemetry should be absent, got %+v", ev.Values)
	}
	if _, err = s.NextFrame(); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Render(
		`<h2>Incident handoff</h2><div class="alert alert-danger">Summary is required.</div><label for="service">Service</label><input id="service"><label for="sev3">SEV-3</label><input id="sev3" type="radio" name="severity" value="sev3"><label for="sev2">SEV-2</label><input id="sev2" type="radio" name="severity" value="sev2"><label for="summary">Summary</label><textarea id="summary" rows="3"></textarea><button id="submit">Send</button>`,
		protocol.DocHTML,
	)); err != nil {
		t.Fatal(err)
	}
	ev, err = s.NextFrame()
	if err != nil {
		t.Fatal(err)
	}
	plain := ev.Plain
	if plain == nil {
		t.Fatal("expected plain frame")
	}
	for _, want := range []string{"Summary is required.", "[payments]", "(*) SEV-2"} {
		if !strings.Contains(*plain, want) {
			t.Fatalf("plain %q missing %q", *plain, want)
		}
	}

	if err := s.Send(protocol.Exit()); err != nil {
		t.Fatal(err)
	}
	ev, err = s.Next()
	if err != nil || ev.Type != "exit" {
		t.Fatalf("exit: %+v err=%v", ev, err)
	}
	if err := s.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestFullAndPatchModesReconstructIdenticalScreens(t *testing.T) {
	script := []protocol.Command{
		protocol.Char("payments"),
		protocol.Key(protocol.KeyTab, nil),
		protocol.Key(protocol.KeyRight, nil),
		protocol.Key(protocol.KeyEnter, nil),
		protocol.Key(protocol.KeyTab, nil),
		protocol.Char("Rollback started"),
		protocol.Key(protocol.KeyEnter, &protocol.KeyModifiers{Ctrl: true}),
		protocol.Scroll(2),
		protocol.Key(protocol.KeyTab, nil),
		protocol.Key(protocol.KeyEnter, nil),
		protocol.Key(protocol.KeyTab, nil),
	}

	full := runScriptedSession(t, script, false)
	patched := runScriptedSession(t, script, true)

	if len(patched.screens) != len(full.screens) {
		t.Fatalf("screen count full=%d patch=%d", len(full.screens), len(patched.screens))
	}
	for i := range full.screens {
		if patched.screens[i] != full.screens[i] {
			t.Fatalf("screen %d differs\nfull=%q\npatch=%q", i, full.screens[i], patched.screens[i])
		}
	}
	if !patched.sawPatch {
		t.Fatal("expected patch frames")
	}
	if full.sawPatch {
		t.Fatal("did not expect patch frames in full mode")
	}
}

func TestResizePreservesStateAndResynchronizesPatchMode(t *testing.T) {
	s := spawnTestSession(t)
	buf := screen.NewBuffer(screen.PreferredPlain)
	frame, err := s.InitialFrame()
	if err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(frame); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Configure(protocol.FramePlain, protocol.FramePatches)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Char("payments")); err != nil {
		t.Fatal(err)
	}
	typed, err := s.NextFrame()
	if err != nil || !typed.IsPatch() {
		t.Fatalf("typed patch frame: %+v err=%v", typed, err)
	}
	if err := buf.Apply(typed); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Key(protocol.KeyLeft, nil)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Resize(20, 10)); err != nil {
		t.Fatal(err)
	}
	resized, err := s.NextFrame()
	if err != nil || resized.IsPatch() {
		t.Fatalf("resized full frame: %+v err=%v", resized, err)
	}
	if resized.FocusedIDString() != "service" {
		t.Fatalf("focusedId = %q", resized.FocusedIDString())
	}
	if err := buf.Apply(resized); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.Text(), "[payment▏s]") {
		t.Fatalf("text = %q", buf.Text())
	}

	if err := s.Send(protocol.Char("!")); err != nil {
		t.Fatal(err)
	}
	after, err := s.NextFrame()
	if err != nil || !after.IsPatch() {
		t.Fatalf("after resize patch: %+v err=%v", after, err)
	}
	if err := buf.Apply(after); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.Text(), "[payment!▏s]") {
		t.Fatalf("text = %q", buf.Text())
	}

	if err := s.Send(protocol.Exit()); err != nil {
		t.Fatal(err)
	}
	if ev, err := s.Next(); err != nil || ev.Type != "exit" {
		t.Fatalf("exit: %+v err=%v", ev, err)
	}
	if err := s.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestRicherKeysAndModifiersRoundTrip(t *testing.T) {
	s := spawnTestSession(t)
	buf := screen.NewBuffer(screen.PreferredPlain)
	if err := buf.Apply(mustInitialFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Configure(protocol.FramePlain, protocol.FramePatches)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Resize(40, 6)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Char("api-gateway")); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Key(protocol.KeyHome, nil)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.Text(), "[▏api-gateway]") {
		t.Fatalf("text = %q", buf.Text())
	}

	if err := s.Send(protocol.Key(protocol.KeyDelete, nil)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.Text(), "[▏pi-gateway]") {
		t.Fatalf("text = %q", buf.Text())
	}

	if err := s.Send(protocol.Key(protocol.KeyEnter, &protocol.KeyModifiers{Ctrl: true})); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Key(protocol.KeyF12, nil)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Key(protocol.KeyDown, nil)); err != nil {
		t.Fatal(err)
	}
	focused, err := s.NextFrame()
	if err != nil || focused.FocusedIDString() != "severity" {
		t.Fatalf("focused: %+v err=%v", focused, err)
	}
	if err := buf.Apply(focused); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Key(protocol.KeyPageDown, nil)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if buf.Viewport() == nil {
		t.Fatal("expected viewport metadata")
	}
	if err := s.Send(protocol.Key(protocol.KeyPageUp, nil)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Exit()); err != nil {
		t.Fatal(err)
	}
	if ev, err := s.Next(); err != nil || ev.Type != "exit" {
		t.Fatalf("exit: %+v err=%v", ev, err)
	}
	if err := s.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestPointerColumnsActivateIntendedGridButton(t *testing.T) {
	s := spawnTestSession(t)
	if _, err := s.InitialFrame(); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Render(
		`:::grid{columns="2" gap="2"}
::button{id="left" label="Left"}
::button{id="right" label="Right"}
:::`,
		protocol.DocTEML,
	)); err != nil {
		t.Fatal(err)
	}
	rendered, err := s.NextFrame()
	if err != nil {
		t.Fatal(err)
	}
	if rendered.Plain == nil {
		t.Fatal("expected plain frame")
	}
	row, col := -1, -1
	for i, line := range strings.Split(*rendered.Plain, "\n") {
		if idx := strings.Index(line, "[ Right ]"); idx >= 0 {
			row, col = i, idx
			break
		}
	}
	if row < 0 {
		t.Fatalf("plain = %q", *rendered.Plain)
	}

	if err := s.Send(protocol.Pointer(row, col)); err != nil {
		t.Fatal(err)
	}
	clicked, err := s.Next()
	if err != nil || clicked.Type != "click" || clicked.ID != "right" {
		t.Fatalf("click: %+v err=%v", clicked, err)
	}
	if ev, err := s.Next(); err != nil || ev.FocusedIDString() != "right" {
		t.Fatalf("focus after click: %+v err=%v", ev, err)
	}

	if err := s.Send(protocol.Exit()); err != nil {
		t.Fatal(err)
	}
	if ev, err := s.Next(); err != nil || ev.Type != "exit" {
		t.Fatalf("exit: %+v err=%v", ev, err)
	}
	if err := s.Wait(); err != nil {
		t.Fatal(err)
	}
}

type scriptResult struct {
	screens  []string
	sawPatch bool
}

func runScriptedSession(t *testing.T, script []protocol.Command, patches bool) scriptResult {
	t.Helper()
	s := spawnTestSession(t)
	buf := screen.NewBuffer(screen.PreferredPlain)
	if err := buf.Apply(mustInitialFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if patches {
		if err := s.Send(protocol.Configure(protocol.FramePlain, protocol.FramePatches)); err != nil {
			t.Fatal(err)
		}
		if err := buf.Apply(mustNextFrame(t, s)); err != nil {
			t.Fatal(err)
		}
	}

	result := scriptResult{screens: []string{buf.Text()}}
	for _, command := range script {
		if err := s.Send(command); err != nil {
			t.Fatal(err)
		}
		frame, err := s.NextFrame()
		if err != nil {
			t.Fatal(err)
		}
		result.sawPatch = result.sawPatch || frame.IsPatch()
		if err := buf.Apply(frame); err != nil {
			t.Fatal(err)
		}
		result.screens = append(result.screens, buf.Text())
	}

	if err := s.Send(protocol.Exit()); err != nil {
		t.Fatal(err)
	}
	if ev, err := s.Next(); err != nil || ev.Type != "exit" {
		t.Fatalf("exit: %+v err=%v", ev, err)
	}
	if err := s.Wait(); err != nil {
		t.Fatal(err)
	}
	return result
}

func mustInitialFrame(t *testing.T, s *engine.Session) protocol.SessionEvent {
	t.Helper()
	frame, err := s.InitialFrame()
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func mustNextFrame(t *testing.T, s *engine.Session) protocol.SessionEvent {
	t.Helper()
	frame, err := s.NextFrame()
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func TestLiveProgressUpdateCommands(t *testing.T) {
	view := filepath.Join(t.TempDir(), "live-progress.teml")
	markup := "::progress{id=\"deploy\" label=\"Deploy\" value=\"0\" max=\"100\"}\n"
	if err := os.WriteFile(view, []byte(markup), 0o644); err != nil {
		t.Fatal(err)
	}

	s := spawnSessionWithView(t, view)
	buf := screen.NewBuffer(screen.PreferredPlain)
	if err := buf.Apply(mustInitialFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Configure(protocol.FramePlain, protocol.FramePatches)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	patchFrames := 0
	for step := 1; step <= 10; step++ {
		value := fmt.Sprintf("%d", step*10)
		if err := s.Send(protocol.Update("deploy", map[string]string{"value": value})); err != nil {
			t.Fatal(err)
		}
		frame, err := s.NextFrame()
		if err != nil {
			t.Fatal(err)
		}
		if frame.IsPatch() {
			patchFrames++
			if len(frame.Patches) > 2 {
				t.Fatalf("expected bounded patches, got %d", len(frame.Patches))
			}
		}
		if err := buf.Apply(frame); err != nil {
			t.Fatal(err)
		}
	}
	if patchFrames == 0 {
		t.Fatal("expected patch frames from live updates")
	}
	if !strings.Contains(buf.Text(), "100%") {
		t.Fatalf("final screen = %q", buf.Text())
	}

	if err := s.Send(protocol.Exit()); err != nil {
		t.Fatal(err)
	}
	if ev, err := s.Next(); err != nil || ev.Type != "exit" {
		t.Fatalf("exit: %+v err=%v", ev, err)
	}
	if err := s.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentMutationCommands(t *testing.T) {
	view := filepath.Join(t.TempDir(), "mutations.teml")
	markup := ":::scroll{id=\"logs\" rows=\"3\"}\nFirst\n:::\n\n:::card{id=\"summary\" title=\"Summary\"}\nPending\n:::\n"
	if err := os.WriteFile(view, []byte(markup), 0o644); err != nil {
		t.Fatal(err)
	}
	s := spawnSessionWithView(t, view)
	buf := screen.NewBuffer(screen.PreferredPlain)
	if err := buf.Apply(mustInitialFrame(t, s)); err != nil {
		t.Fatal(err)
	}
	if err := s.Send(protocol.Configure(protocol.FramePlain, protocol.FramePatches)); err != nil {
		t.Fatal(err)
	}
	if err := buf.Apply(mustNextFrame(t, s)); err != nil {
		t.Fatal(err)
	}

	if err := s.Send(protocol.Append("logs", "Second", "")); err != nil {
		t.Fatal(err)
	}
	appended := mustNextFrame(t, s)
	if !appended.IsPatch() {
		t.Fatal("append should preserve patch continuity")
	}
	if err := buf.Apply(appended); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.Text(), "Second") {
		t.Fatalf("append text = %q", buf.Text())
	}

	replacement := ":::card{id=\"summary\" title=\"Summary\"}\nComplete\n:::"
	if err := s.Send(protocol.Replace("summary", replacement, "")); err != nil {
		t.Fatal(err)
	}
	replaced := mustNextFrame(t, s)
	if replaced.IsPatch() {
		t.Fatal("replace should be a full resynchronization")
	}
	if err := buf.Apply(replaced); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.Text(), "Complete") {
		t.Fatalf("replace text = %q", buf.Text())
	}

	if err := s.Send(protocol.Remove("summary")); err != nil {
		t.Fatal(err)
	}
	removed := mustNextFrame(t, s)
	if removed.IsPatch() {
		t.Fatal("remove should be a full resynchronization")
	}
	if err := buf.Apply(removed); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.Text(), "Complete") {
		t.Fatalf("remove text = %q", buf.Text())
	}
}
