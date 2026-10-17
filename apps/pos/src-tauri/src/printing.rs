//! Raw network printing (ESC/POS over TCP, "port 9100"). The UI renders receipts to an ESC/POS
//! raster job; this module only delivers bytes to the printer. Targets are restricted to the
//! standard raw-printing ports and jobs are size-limited, so the webview cannot use this command
//! as a general-purpose network client.

use std::io::{self, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Raw printing ports used by network printers (9100 is the de-facto standard).
pub const ALLOWED_PORTS: std::ops::RangeInclusive<u16> = 9100..=9109;
/// Largest accepted job (a long 80 mm raster receipt is well under 1 MiB).
pub const MAX_JOB_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum TargetError {
    EmptyHost,
    PortNotAllowed(u16),
    EmptyJob,
    JobTooLarge(usize),
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyHost => write!(f, "printer host is empty"),
            Self::PortNotAllowed(p) => write!(f, "port {p} is not a raw printing port (9100-9109)"),
            Self::EmptyJob => write!(f, "print job is empty"),
            Self::JobTooLarge(n) => write!(f, "print job too large ({n} bytes)"),
        }
    }
}

/// Validates a print request before any network access.
pub fn validate_target(host: &str, port: u16, job_len: usize) -> Result<(), TargetError> {
    if host.trim().is_empty() {
        return Err(TargetError::EmptyHost);
    }
    if !ALLOWED_PORTS.contains(&port) {
        return Err(TargetError::PortNotAllowed(port));
    }
    if job_len == 0 {
        return Err(TargetError::EmptyJob);
    }
    if job_len > MAX_JOB_BYTES {
        return Err(TargetError::JobTooLarge(job_len));
    }
    Ok(())
}

/// Connects, writes the whole job and closes the write side so the printer starts printing.
pub fn send_raw(host: &str, port: u16, data: &[u8], timeout: Duration) -> io::Result<()> {
    let address = (host.trim(), port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "printer address not found"))?;
    let mut stream = TcpStream::connect_timeout(&address, timeout)?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(data)?;
    stream.flush()?;
    stream.shutdown(Shutdown::Write)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn delivers_the_whole_job_to_a_listening_printer() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let printer = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept");
            let mut received = Vec::new();
            socket.read_to_end(&mut received).expect("read");
            received
        });
        let job: Vec<u8> = (0..=255u8).cycle().take(10_000).collect();
        send_raw("127.0.0.1", port, &job, Duration::from_secs(2)).expect("send");
        assert_eq!(printer.join().expect("join"), job);
    }

    #[test]
    fn fails_cleanly_when_no_printer_answers() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        assert!(send_raw("127.0.0.1", port, &[0x1b, 0x40], Duration::from_millis(500)).is_err());
    }

    #[test]
    fn only_raw_printing_ports_and_sane_jobs_are_allowed() {
        assert_eq!(validate_target("192.168.1.50", 9100, 10), Ok(()));
        assert_eq!(validate_target("printer.local", 9109, 10), Ok(()));
        assert_eq!(validate_target(" ", 9100, 10), Err(TargetError::EmptyHost));
        assert_eq!(
            validate_target("10.0.0.5", 22, 10),
            Err(TargetError::PortNotAllowed(22))
        );
        assert_eq!(
            validate_target("10.0.0.5", 9100, 0),
            Err(TargetError::EmptyJob)
        );
        assert_eq!(
            validate_target("10.0.0.5", 9100, MAX_JOB_BYTES + 1),
            Err(TargetError::JobTooLarge(MAX_JOB_BYTES + 1))
        );
    }
}
