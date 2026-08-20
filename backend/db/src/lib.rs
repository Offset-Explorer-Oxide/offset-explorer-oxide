pub mod connections;
pub mod tabs;
pub mod topic_schemas;

use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};

pub async fn init_pool(database_url: &str) -> Result<SqlitePool, AppError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to connect to sqlite at {database_url}"))?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .change_context(AppError::Db)
        .attach_printable("failed to run migrations")?;

    Ok(pool)
}
