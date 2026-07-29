//! TeML engine discovery and version diagnostics.

use std::ffi::OsStr;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// How the executable was chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineSource {
    /// Caller supplied an explicit program/argument list.
    Explicit,
    /// `$TEML_CLI` environment variable.
    TemlCliEnv,
    /// A package-managed script path (for example `dist/cli/main.js`).
    PackagePath,
    /// `teml` found on `PATH`.
    Path,
}

/// Explicit engine override passed to [`resolve_engine`].
#[derive(Debug, Clone)]
pub struct ExplicitEngine {
    /// Executable to spawn (for example `node`, a SEA binary, or a `.js` entry).
    pub program: String,
    /// Arguments before the `run` subcommand (for example the CLI script path).
    pub args: Vec<String>,
}

/// Options controlling engine resolution order.
#[derive(Debug, Clone, Default)]
pub struct EngineResolveOptions {
    /// Explicit program and prefix arguments (for example `node` + script path).
    pub explicit: Option<ExplicitEngine>,
    /// Additional Node script paths tried after `$TEML_CLI`.
    pub package_scripts: Vec<PathBuf>,
}

/// A resolved engine ready to spawn as `program` + `args` + `run …`.
#[derive(Debug, Clone)]
pub struct ResolvedEngine {
    /// Executable program name or path.
    pub program: String,
    /// Prefix arguments (script path when using Node).
    pub args: Vec<String>,
    /// Which discovery step matched.
    pub source: EngineSource,
    /// Output of `program … --version` when probing succeeds.
    pub version: Option<String>,
    /// Human-readable path recorded in diagnostics.
    pub resolved_path: String,
}

impl ResolvedEngine {
    /// Human-readable summary for logs and error messages.
    pub fn diagnostics(&self) -> String {
        let version = self
            .version
            .as_deref()
            .map(|v| format!(" (version {v})"))
            .unwrap_or_default();
        format!(
            "engine={} source={:?}{}",
            self.resolved_path, self.source, version
        )
    }

    /// Prefix argument list for spawning `teml run …` (program + args).
    pub fn argv_prefix(&self) -> Vec<String> {
        let mut argv = vec![self.program.clone()];
        argv.extend(self.args.clone());
        argv
    }
}

/// Resolution failures with actionable context.
#[derive(Debug)]
pub enum EngineError {
    /// No candidate executable was found.
    NotFound {
        /// Paths and env vars that were tried.
        searched: Vec<String>,
    },
    /// `--version` probing failed for a candidate executable.
    VersionProbe {
        /// Program that was executed.
        program: String,
        /// Underlying failure description.
        message: String,
    },
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound { searched } => {
                write!(
                    f,
                    "TeML engine not found; set TEML_CLI or build the repository CLI. Searched: {}",
                    searched.join(", ")
                )
            }
            Self::VersionProbe { program, message } => {
                write!(f, "failed to probe version for `{program}`: {message}")
            }
        }
    }
}

impl std::error::Error for EngineError {}

/// Resolve a TeML engine using the shared discovery order:
/// explicit option → `$TEML_CLI` → package script paths → `teml` on `PATH`.
pub fn resolve_engine(options: &EngineResolveOptions) -> Result<ResolvedEngine, EngineError> {
    let mut searched = Vec::new();

    if let Some(explicit) = &options.explicit {
        let (program, args) = normalize_engine_invocation(&explicit.program, &explicit.args);
        let resolved_path = format_path(&program, &args);
        return finish(program, args, EngineSource::Explicit, resolved_path);
    }

    if let Ok(cli) = std::env::var("TEML_CLI") {
        searched.push(format!("$TEML_CLI={cli}"));
        if Path::new(&cli).exists() {
            let (program, args) = invocation_for_path(&cli);
            return finish(program, args, EngineSource::TemlCliEnv, cli);
        }
    }

    for script in &options.package_scripts {
        let display = script.display().to_string();
        searched.push(display.clone());
        if script.exists() {
            let (program, args) = invocation_for_path(&display);
            return finish(program, args, EngineSource::PackagePath, display);
        }
    }

    searched.push("teml on PATH".into());
    if path_available("teml") {
        return finish("teml".into(), Vec::new(), EngineSource::Path, "teml".into());
    }

    Err(EngineError::NotFound { searched })
}

/// Whether `path` is a Node CLI entry script (`.js`, `.mjs`, `.cjs`).
pub fn is_js_entry(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|ext| matches!(ext, "js" | "mjs" | "cjs"))
}

/// Map an engine path to `(program, prefix_args)`.
///
/// JavaScript entry scripts run under `node`; native SEA/`teml` binaries run directly.
pub fn invocation_for_path(path: &str) -> (String, Vec<String>) {
    if is_js_entry(path) {
        ("node".into(), vec![path.to_owned()])
    } else {
        (path.to_owned(), Vec::new())
    }
}

fn normalize_engine_invocation(program: &str, args: &[String]) -> (String, Vec<String>) {
    if args.is_empty() {
        return invocation_for_path(program);
    }
    if program == "node" && args.len() == 1 && is_js_entry(&args[0]) {
        return (program.to_owned(), args.to_owned());
    }
    (program.to_owned(), args.to_owned())
}

fn finish(
    program: String,
    args: Vec<String>,
    source: EngineSource,
    resolved_path: String,
) -> Result<ResolvedEngine, EngineError> {
    let version = probe_version(&program, &args).ok();
    Ok(ResolvedEngine {
        program,
        args,
        source,
        version,
        resolved_path,
    })
}

fn format_path(program: &str, args: &[String]) -> String {
    if args.is_empty() {
        program.to_owned()
    } else {
        format!("{program} {}", args.join(" "))
    }
}

fn path_available(program: &str) -> bool {
    let path_var = match std::env::var_os("PATH") {
        Some(value) => value,
        None => return false,
    };
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return true;
        }
        #[cfg(windows)]
        {
            for ext in [".exe", ".cmd", ".bat"] {
                let with_ext = dir.join(format!("{program}{ext}"));
                if with_ext.is_file() {
                    return true;
                }
            }
        }
    }
    false
}

fn probe_version(program: &str, args: &[String]) -> Result<String, EngineError> {
    let output = run_version_command(program, args)?;
    if !output.status.success() {
        return Err(EngineError::VersionProbe {
            program: program.to_owned(),
            message: format!("exit status {}", output.status),
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(EngineError::VersionProbe {
            program: program.to_owned(),
            message: "empty version output".into(),
        });
    }
    Ok(trimmed.to_owned())
}

fn run_version_command(program: &str, args: &[String]) -> Result<Output, EngineError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command.output().map_err(|error| EngineError::VersionProbe {
        program: program.to_owned(),
        message: error.to_string(),
    })
}

/// Default package script locations for monorepo consumers.
pub fn default_package_scripts(manifest_dir: &Path) -> Vec<PathBuf> {
    [
        manifest_dir.join("../../dist/cli/main.js"),
        manifest_dir.join("../../../dist/cli/main.js"),
    ]
    .into_iter()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_entries_spawn_via_node() {
        assert_eq!(
            invocation_for_path("/opt/teml/dist/cli/main.js"),
            ("node".into(), vec!["/opt/teml/dist/cli/main.js".into()])
        );
        assert_eq!(
            invocation_for_path("/tmp/entry.mjs"),
            ("node".into(), vec!["/tmp/entry.mjs".into()])
        );
        assert_eq!(
            invocation_for_path("/tmp/bundle.cjs"),
            ("node".into(), vec!["/tmp/bundle.cjs".into()])
        );
    }

    #[test]
    fn native_binaries_spawn_directly() {
        assert_eq!(
            invocation_for_path("/usr/local/bin/teml"),
            ("/usr/local/bin/teml".into(), Vec::new())
        );
        assert_eq!(
            invocation_for_path("/build/teml-sea"),
            ("/build/teml-sea".into(), Vec::new())
        );
    }

    #[test]
    fn explicit_js_path_without_args_normalizes_to_node() {
        let (program, args) = normalize_engine_invocation("/repo/dist/cli/main.js", &[]);
        assert_eq!(program, "node");
        assert_eq!(args, vec!["/repo/dist/cli/main.js".to_string()]);
    }

    #[test]
    fn explicit_node_plus_script_is_preserved() {
        let (program, args) =
            normalize_engine_invocation("node", &["/repo/dist/cli/main.js".into()]);
        assert_eq!(program, "node");
        assert_eq!(args, vec!["/repo/dist/cli/main.js".to_string()]);
    }

    #[test]
    fn resolves_repo_engine_when_present() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let scripts = default_package_scripts(&manifest);
        let options = EngineResolveOptions {
            package_scripts: scripts,
            ..Default::default()
        };
        let engine = resolve_engine(&options).expect("repo engine");
        assert_eq!(engine.program, "node");
        assert!(engine
            .args
            .first()
            .is_some_and(|arg| arg.ends_with("dist/cli/main.js")));
        assert!(matches!(
            engine.source,
            EngineSource::PackagePath | EngineSource::TemlCliEnv | EngineSource::Explicit
        ));
        assert!(engine.version.is_some());
    }
}
