#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod logging;
mod state;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;

/// `--librdkafka-features [path]`: report which compression codecs *this
/// executable* can decode, then exit — 0 when every required one is compiled
/// in, 1 when any is missing.
///
/// Every earlier check of this was made against something other than the
/// artifact users install: a Cargo feature resolving, a vcpkg install
/// succeeding, a generated `config.h`, a `cargo test` binary built from the
/// same workspace. v0.37.0 shipped a Windows build with Snappy compiled out
/// while all of those were green. This one cannot be that kind of proxy — it
/// is the shipped executable answering about itself.
///
/// Release builds on Windows have no console (`windows_subsystem = "windows"`
/// above), so the answer also goes to `path` when one is given, and the exit
/// code carries the verdict regardless of where output can be seen.
fn report_librdkafka_features(path: Option<&str>) -> ! {
    let features = kafkaoxide_kafka::build_info::builtin_features();
    let missing = kafkaoxide_kafka::build_info::missing_required_features();

    let report = if missing.is_empty() {
        format!("ok\nbuiltin.features = {features}\n")
    } else {
        format!(
            "MISSING {}\nbuiltin.features = {features}\nTopics compressed with a missing \
             codec fail every poll with \"Local: Not Implemented\".\n",
            missing.join(", "),
        )
    };

    print!("{report}");
    if let Some(path) = path {
        let _ = std::fs::write(path, &report);
    }
    std::process::exit(if missing.is_empty() { 0 } else { 1 });
}

fn main() {
    let mut args = std::env::args().skip(1);
    if let Some(flag) = args.next() {
        if flag == "--librdkafka-features" {
            report_librdkafka_features(args.next().as_deref());
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // The window title is set here (not left as the static string in
            // tauri.conf.json) so it always shows the actual running
            // version — reading it from `package_info()` keeps it in sync
            // automatically with tauri.conf.json's `version` field with no
            // separate value to remember to update on every version bump.
            if let Some(window) = handle.get_webview_window("main") {
                let version = handle.package_info().version.to_string();
                let _ = window.set_title(&format!("Offset Explorer Oxide v{version}"));
            }

            // Before any client is built, so every connection this app opens
            // identifies itself as `kafkaoxide/<version>` rather than
            // librdkafka's shared default of `rdkafka`. The version can only
            // come from here: the workspace crates all sit at 0.1.0 and are
            // not bumped per release, so `tauri.conf.json` (via
            // `package_info()`) is the only true version of the app.
            kafkaoxide_kafka::set_app_version(&handle.package_info().version.to_string());

            tauri::async_runtime::block_on(async move {
                let data_dir = handle.path().app_data_dir().expect("app data dir");
                std::fs::create_dir_all(&data_dir).expect("create app data dir");
                let db_path = data_dir.join("kafkaoxide.sqlite");
                let database_url = format!("sqlite://{}?mode=rwc", db_path.display());
                let pool = kafkaoxide_db::init_pool(&database_url)
                    .await
                    .expect("failed to initialize database");

                handle.manage(AppState {
                    pool,
                    kafka: Arc::new(kafkaoxide_kafka::RdKafkaClient::new()),
                    zookeeper: Arc::new(kafkaoxide_kafka::TcpZookeeperClient),
                    connections: kafkaoxide_core::ConnectionRegistry::default(),
                    fetch_cancellations: kafkaoxide_core::FetchCancellations::default(),
                    schema_registry: kafkaoxide_schema_registry::SchemaRegistryClients::default(),
                });

                logging::emit_log(&handle, "info", "Application started");

                // Logged so the id is discoverable from the app itself: it is
                // what an operator filters broker metrics and quotas by, and
                // it is the line that makes a forgotten `set_app_version`
                // visible (it would read "kafkaoxide" with no version).
                logging::emit_log(
                    &handle,
                    "info",
                    format!("Broker connections identify as client.id={}", kafkaoxide_kafka::broker_client_id()),
                );

                // Enumerating the OS trust store is the one fixed cost every
                // TLS connection pays; doing it here means the user's first
                // click doesn't.
                let ca_started = std::time::Instant::now();
                kafkaoxide_kafka::warm_native_ca_bundle();
                logging::emit_log(
                    &handle,
                    "info",
                    format!("Loaded the OS trust store in {} ms", ca_started.elapsed().as_millis()),
                );

                // Which compression codecs work is fixed at compile time
                // inside librdkafka, and a missing one stays invisible until a
                // user happens to open a topic that uses it — at which point
                // every poll fails with a bare "Local: Not Implemented". Six
                // releases went out before that could be diagnosed. Recording
                // it at startup means the Logs panel answers the question
                // directly, from the build the user is actually running.
                let features = kafkaoxide_kafka::build_info::builtin_features();
                let missing = kafkaoxide_kafka::build_info::missing_required_features();
                if missing.is_empty() {
                    logging::emit_log(&handle, "info", format!("librdkafka features: {features}"));
                } else {
                    logging::emit_log(
                        &handle,
                        "error",
                        format!(
                            "This build of librdkafka is missing {}. Topics compressed with \
                             those codecs will fail to fetch with \"Local: Not Implemented\". \
                             Compiled with: {features}",
                            missing.join(", "),
                        ),
                    );
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connections::connection_list,
            commands::connections::connection_create,
            commands::connections::connection_update,
            commands::connections::connection_delete,
            commands::connections::connections_export,
            commands::connections::connections_import,
            commands::connections::connection_check_status,
            commands::connections::connection_ping_bootstrap,
            commands::connections::connection_ping_zookeeper,
            commands::connections::connection_test,
            commands::connections::connection_connect,
            commands::connections::connection_disconnect,
            commands::connections::connection_is_connected,
            commands::connections::connection_auth_block_reason,
            commands::connections::connection_list_brokers,
            commands::connections::connection_list_topics,
            commands::connections::connection_list_consumer_groups,
            commands::connections::connection_count_topic_messages,
            commands::connections::connection_fetch_messages,
            commands::connections::connection_cancel_fetch,
            commands::connections::connection_list_partitions,
            commands::connections::connection_describe_topic_config,
            commands::connections::connection_fetch_consumer_group_lag,
            commands::schema::topic_schema_get,
            commands::schema::topic_schema_set,
            commands::schema::topic_schema_delete,
            commands::schema::connection_decode_avro,
            commands::tabs::tab_list,
            commands::tabs::tab_create,
            commands::tabs::tab_rename,
            commands::tabs::tab_delete,
            commands::tabs::tab_reorder,
            commands::system::trim_process_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
