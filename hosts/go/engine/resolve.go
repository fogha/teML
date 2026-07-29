package engine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Source names where an engine executable was discovered.
const (
	SourceExplicit = "explicit"
	SourceEnv      = "TEML_CLI"
	SourcePackage  = "package"
	SourcePATH     = "PATH"
)

// ResolvedEngine records how the teml runtime was located.
type ResolvedEngine struct {
	Program      string
	Args         []string
	Source       string
	ResolvedPath string
	Version      string
}

// ResolveOptions controls engine discovery.
type ResolveOptions struct {
	// ExplicitPath is the highest-priority engine location (API option).
	ExplicitPath string
	// PackagePath overrides the default monorepo dist/cli/main.js probe.
	PackagePath string
}

// Resolve locates a teml engine in priority order:
// explicit path → TEML_CLI → package-managed dist/cli/main.js → teml on PATH.
//
// JavaScript entry scripts (.js, .mjs, .cjs) are spawned via node. Native
// executables (including Node SEA single-binary artifacts) run directly.
// Missing engines return an error; callers must not silently skip.
func Resolve(opts ResolveOptions) (ResolvedEngine, error) {
	if opts.ExplicitPath != "" {
		engine, err := engineFromPath(opts.ExplicitPath)
		if err != nil {
			return ResolvedEngine{}, fmt.Errorf("explicit engine not found: %w", err)
		}
		engine.Source = SourceExplicit
		engine.Version = probeVersion(engine)
		return engine, nil
	}

	if cli, ok := os.LookupEnv("TEML_CLI"); ok && strings.TrimSpace(cli) != "" {
		engine, err := engineFromPath(cli)
		if err != nil {
			return ResolvedEngine{}, fmt.Errorf("TEML_CLI not found: %w", err)
		}
		engine.Source = SourceEnv
		engine.Version = probeVersion(engine)
		return engine, nil
	}

	path := opts.PackagePath
	if path == "" {
		path = defaultPackageCLI()
	}
	if path != "" {
		if _, err := os.Stat(path); err == nil {
			engine, err := engineFromPath(path)
			if err != nil {
				return ResolvedEngine{}, err
			}
			engine.Source = SourcePackage
			engine.Version = probeVersion(engine)
			return engine, nil
		}
	}

	path, err := exec.LookPath("teml")
	if err == nil {
		engine := ResolvedEngine{
			Program:      path,
			ResolvedPath: path,
			Source:       SourcePATH,
		}
		engine.Version = probeVersion(engine)
		return engine, nil
	}

	return ResolvedEngine{}, errors.New("teml engine not found: set TEML_CLI, build dist/cli/main.js, or install teml on PATH")
}

func engineFromPath(path string) (ResolvedEngine, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return ResolvedEngine{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return ResolvedEngine{}, err
	}
	if info.IsDir() {
		return ResolvedEngine{}, fmt.Errorf("%s is a directory", abs)
	}
	if needsNodeLauncher(abs) {
		return ResolvedEngine{
			Program:      "node",
			Args:         []string{abs},
			ResolvedPath: abs,
		}, nil
	}
	return ResolvedEngine{
		Program:      abs,
		ResolvedPath: abs,
	}, nil
}

func needsNodeLauncher(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".js", ".mjs", ".cjs":
		return true
	default:
		return false
	}
}

func defaultPackageCLI() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
	return filepath.Join(repoRoot, "dist", "cli", "main.js")
}

func probeVersion(engine ResolvedEngine) string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	args := append(append([]string{}, engine.Args...), "--version")
	cmd := exec.CommandContext(ctx, engine.Program, args...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Diagnostics returns a human-readable summary of the resolved engine.
func (e ResolvedEngine) Diagnostics() string {
	args := strings.Join(e.Args, " ")
	version := e.Version
	if version == "" {
		version = "unknown"
	}
	return fmt.Sprintf("engine=%s %s path=%s source=%s version=%s", e.Program, args, e.ResolvedPath, e.Source, version)
}

// IsNodeScript reports whether the resolved artifact is launched via node.
func (e ResolvedEngine) IsNodeScript() bool {
	return e.Program == "node" && len(e.Args) > 0
}
