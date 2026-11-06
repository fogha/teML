//! Private, cancellable stdout reader. Only this thread reads the pipe, so once
//! bytes (or EOF) are available a read cannot race with another consumer.
use std::io::{self, Read};
use std::process::ChildStdout;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub(crate) struct CancellablePipe {
    pub stdout: ChildStdout,
    pub cancelled: Arc<AtomicBool>,
}

impl Read for CancellablePipe {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        loop {
            if self.cancelled.load(Ordering::Acquire) {
                return Ok(0);
            }
            match readable(&self.stdout) {
                Ok(true) => return self.stdout.read(buffer),
                Ok(false) => {}
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error),
            }
        }
    }
}

#[cfg(unix)]
fn readable(stdout: &ChildStdout) -> io::Result<bool> {
    use std::os::fd::AsRawFd;
    use std::os::raw::{c_int, c_short};
    #[repr(C)]
    struct PollFd {
        fd: c_int,
        events: c_short,
        revents: c_short,
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    type Nfds = std::os::raw::c_ulong;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    type Nfds = std::os::raw::c_uint;
    extern "C" {
        fn poll(fds: *mut PollFd, count: Nfds, timeout: c_int) -> c_int;
    }
    let mut fd = PollFd {
        fd: stdout.as_raw_fd(),
        events: 1, /* POLLIN */
        revents: 0,
    };
    // SAFETY: one initialized pollfd, owned live descriptor, no concurrent close.
    // POLLHUP also makes the subsequent read return buffered bytes or EOF.
    let result = unsafe { poll(&mut fd, 1, 10) };
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(result > 0)
    }
}

#[cfg(windows)]
fn readable(stdout: &ChildStdout) -> io::Result<bool> {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    #[link(name = "kernel32")]
    extern "system" {
        fn PeekNamedPipe(
            pipe: *mut c_void,
            buffer: *mut c_void,
            size: u32,
            read: *mut u32,
            available: *mut u32,
            left: *mut u32,
        ) -> i32;
    }
    let mut available = 0;
    // SAFETY: the live anonymous pipe is owned by this reader; only the valid
    // available pointer is written. All optional buffers are null.
    let result = unsafe {
        PeekNamedPipe(
            stdout.as_raw_handle(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut available,
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        let error = io::Error::last_os_error();
        // ERROR_BROKEN_PIPE: let Read observe EOF through the standard library.
        if error.raw_os_error() == Some(109) {
            return Ok(true);
        }
        return Err(error);
    }
    if available == 0 {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(available > 0)
}
