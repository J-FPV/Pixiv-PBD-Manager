#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn main() {
    if let Err(error) = run() {
        let _ = writeln_no_panic(std::io::stderr(), &format!("pixiv-pbd-api launcher failed: {error}"));
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("pixiv-pbd-api launcher is only built for Windows.");
    std::process::exit(1);
}

#[cfg(windows)]
fn writeln_no_panic(mut writer: impl std::io::Write, message: &str) -> std::io::Result<()> {
    writer.write_all(message.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()
}

#[cfg(windows)]
fn run() -> std::io::Result<()> {
    use std::env;
    use std::io;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::thread;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let launcher = env::current_exe()?;
    let launcher_dir = launcher.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "could not resolve pixiv-pbd-api launcher directory",
        )
    })?;
    let worker = launcher_dir.join("pixiv-pbd-api-worker.exe");

    let mut child = Command::new(&worker)
        .args(env::args_os().skip(1))
        .current_dir(launcher_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;

    if let Some(mut child_stdin) = child.stdin.take() {
        thread::spawn(move || {
            let mut stdin = io::stdin().lock();
            let _ = io::copy(&mut stdin, &mut child_stdin);
        });
    }

    let mut child_stdout = child.stdout.take().ok_or_else(|| {
        io::Error::new(io::ErrorKind::BrokenPipe, "worker stdout pipe was not captured")
    })?;
    let stdout_thread = thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        let _ = io::copy(&mut child_stdout, &mut stdout);
    });

    let mut child_stderr = child.stderr.take().ok_or_else(|| {
        io::Error::new(io::ErrorKind::BrokenPipe, "worker stderr pipe was not captured")
    })?;
    let stderr_thread = thread::spawn(move || {
        let mut stderr = io::stderr().lock();
        let _ = io::copy(&mut child_stderr, &mut stderr);
    });

    let status = child.wait()?;
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    std::process::exit(status.code().unwrap_or(1));
}
