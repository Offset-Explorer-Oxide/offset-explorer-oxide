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

#[cfg(test)]
mod tests {
    use super::*;

    /// `init_pool` is the app's only entry point into storage: it opens the
    /// database *and* brings its schema up to date, and every command that
    /// follows assumes both happened. The migrations are the part worth
    /// pinning — a pool that connects but skips them fails later, at the
    /// first query, in whichever feature happened to run first.
    #[tokio::test]
    async fn init_pool_opens_a_database_and_runs_every_migration() {
        let pool = init_pool("sqlite::memory:").await.expect("init_pool failed");

        // The tables the migrations create, one per feature area that stores
        // anything — queried rather than merely listed, so a table that
        // exists with the wrong shape fails here too.
        for table in ["connections", "tabs", "topic_schemas"] {
            sqlx::query(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|err| panic!("migrations left `{table}` unusable: {err}"));
        }
    }

    /// Running against an already-migrated database is the ordinary case —
    /// every launch after the first — so it must be a no-op rather than an
    /// error about migrations that have already been applied.
    #[tokio::test]
    async fn init_pool_is_idempotent_against_an_existing_database() {
        let dir = std::env::temp_dir().join(format!("kafkaoxide-db-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("failed to create temp dir");
        let url = format!("sqlite://{}?mode=rwc", dir.join("app.db").display());

        init_pool(&url).await.expect("first init_pool failed");
        init_pool(&url).await.expect("second init_pool failed on an already-migrated database");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A path that cannot be opened has to surface as an `AppError::Db`
    /// rather than a panic — this is what the app reports when its data
    /// directory is missing or unwritable.
    #[tokio::test]
    async fn init_pool_reports_a_db_error_for_an_unopenable_path() {
        let error = init_pool("sqlite:///nonexistent-directory/kafkaoxide/app.db")
            .await
            .expect_err("opening a database under a missing directory must fail");

        assert!(matches!(error.current_context(), AppError::Db), "got {error:?}");
    }
}
