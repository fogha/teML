package engine_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/fogha/teml/hosts/go/engine"
)

func writeExecutable(t *testing.T, name, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResolveUsesNodeForJavaScriptEntrypoints(t *testing.T) {
	t.Setenv("TEML_CLI", "")
	for _, ext := range []string{".js", ".mjs", ".cjs"} {
		ext := ext
		t.Run(ext, func(t *testing.T) {
			path := writeExecutable(t, "engine"+ext, "#!/usr/bin/env node\n")
			eng, err := engine.Resolve(engine.ResolveOptions{ExplicitPath: path})
			if err != nil {
				t.Fatal(err)
			}
			if !eng.IsNodeScript() || eng.Program != "node" || eng.Args[0] != path {
				t.Fatalf("engine = %+v", eng)
			}
		})
	}
}

func TestResolveExecutesNativeBinaryDirectly(t *testing.T) {
	t.Setenv("TEML_CLI", "")
	path := writeExecutable(t, "teml-sea", "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.0.0-sea; fi\n")
	eng, err := engine.Resolve(engine.ResolveOptions{ExplicitPath: path})
	if err != nil {
		t.Fatal(err)
	}
	if eng.IsNodeScript() || eng.Program != path || len(eng.Args) != 0 {
		t.Fatalf("engine = %+v", eng)
	}
	if eng.Version != "0.0.0-sea" {
		t.Fatalf("version = %q", eng.Version)
	}
}

func TestResolveExplicitOverridesTEMLCLI(t *testing.T) {
	explicit := writeExecutable(t, "teml-native", "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo explicit; fi\n")
	t.Setenv("TEML_CLI", filepath.Join(t.TempDir(), "unused.js"))
	eng, err := engine.Resolve(engine.ResolveOptions{ExplicitPath: explicit})
	if err != nil {
		t.Fatal(err)
	}
	if eng.Source != engine.SourceExplicit || eng.Program != explicit {
		t.Fatalf("engine = %+v", eng)
	}
}

func TestResolveMissingExplicitFails(t *testing.T) {
	t.Setenv("TEML_CLI", "")
	_, err := engine.Resolve(engine.ResolveOptions{ExplicitPath: "/nonexistent/teml-engine"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveMissingTEMLCLIFails(t *testing.T) {
	t.Setenv("TEML_CLI", "/nonexistent/teml-cli.js")
	_, err := engine.Resolve(engine.ResolveOptions{})
	if err == nil {
		t.Fatal("expected error")
	}
}
