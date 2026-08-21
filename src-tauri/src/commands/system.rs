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
