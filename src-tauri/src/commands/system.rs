use crate::commands::connections::CommandError;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use error_stack::ResultExt;
use kafkaoxide_core::AppError;

/// Asks the OS to trim this process's working set — the number Windows'
/// Task Manager shows as "Memory". Clearing the frontend's cached rows/
/// selection (a JS-side action) and dropping Rust's own per-fetch native
/// allocations (Kafka clients, decoded payload buffers, JSON IPC framing)
/// both free that memory correctly, but neither the JS engine's heap nor
/// Rust's default allocator eagerly hands freed pages back to the OS —
/// both keep them reserved for the next allocation, which is normal
/// runtime behavior, not a leak (this is unrelated to the earlier,
/// genuinely-unbounded Windows growth issue, already root-caused and fixed
/// separately — that was continuous native-client creation on a timer;
/// this is memory retained-for-reuse after real, one-time work). On
/// Windows specifically, `SetProcessWorkingSetSize` with (-1, -1) is the
/// documented way to force an immediate trim of the visible working set
/// regardless — it doesn't change what the app can still allocate later,
/// it just evicts currently-unused pages right now so the number in Task
/// Manager actually reflects that. No-op everywhere else — macOS/Linux
/// don't report memory this way, and the growth this addresses was
/// reported as Windows-only to begin with.
#[tauri::command]
pub fn trim_process_memory() {
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};
        unsafe {
            let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
        }
    }
}

/// Backs the payload viewer's Save and Download buttons. `path` is resolved
/// by the frontend beforehand via the native save dialog — this command only
/// decodes and writes the bytes, exactly like `connections_export`.
///
/// Takes base64 rather than a `Vec<u8>`: Tauri's IPC is JSON, so a byte
/// vector crosses it as a decimal array — roughly four characters per byte
/// against base64's four per three, i.e. three times the transfer for the
/// multi-megabyte payloads this button exists for. It is also already the
/// shape the payload is held in on the frontend, so nothing has to be
/// re-encoded to call this.
///
/// Writing *bytes* rather than a string is the point of the Download half:
/// a payload is an arbitrary Kafka byte string, not guaranteed UTF-8, and
/// the viewer's on-screen text is a lossy decode of it (invalid sequences
/// become U+FFFD). Saving that text back would hand the user a file that no
/// longer matches what is on the broker.
#[tauri::command]
pub fn payload_save(path: String, contents_base64: String) -> Result<(), CommandError> {
    let bytes = BASE64
        .decode(&contents_base64)
        .change_context(AppError::Validation)
        .attach("contents aren't valid base64")?;
    std::fs::write(&path, bytes)
        .change_context(AppError::Validation)
        .attach("failed to write the file")?;
    Ok(())
}
