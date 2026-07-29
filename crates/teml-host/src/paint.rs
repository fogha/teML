//! ONLCR-safe full-screen repaint helpers.

use crate::screen::ScreenBuffer;
use std::io::{self, Write};

/// Expand `\n` to `\r\n` so raw-mode hosts do not staircase across the terminal.
pub fn onlcr(text: &str) -> String {
    text.replace('\n', "\r\n")
}

/// Clear the screen, move to the origin, and write ONLCR-safe frame text.
pub fn paint<W: Write>(screen: &ScreenBuffer, mut out: W) -> io::Result<()> {
    #[cfg(feature = "terminal")]
    {
        use crossterm::{
            cursor::MoveTo,
            terminal::{Clear, ClearType},
            ExecutableCommand,
        };
        out.execute(Clear(ClearType::All))?.execute(MoveTo(0, 0))?;
    }
    write!(out, "{}", onlcr(&screen.text()))?;
    out.flush()
}
