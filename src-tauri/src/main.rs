#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod logging;
mod state;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
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
                    kafka: Arc::new(kafkaoxide_kafka::RdKafkaClient),
                    zookeeper: Arc::new(kafkaoxide_kafka::TcpZookeeperClient),
                    connections: kafkaoxide_core::ConnectionRegistry::default(),
                });

                logging::emit_log(&handle, "info", "Application started");
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
            commands::connections::connection_list_brokers,
            commands::connections::connection_list_topics,
            commands::connections::connection_list_consumer_groups,
            commands::connections::connection_count_topic_messages,
            commands::connections::connection_fetch_messages,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
