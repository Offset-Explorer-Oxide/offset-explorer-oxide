use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Db,
    Kafka,
    Secrets,
    Validation,
    NotFound,
    Zookeeper,
    SchemaRegistry,
    Decode,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Db => write!(f, "database error"),
            AppError::Kafka => write!(f, "kafka error"),
            AppError::Secrets => write!(f, "secrets store error"),
            AppError::Validation => write!(f, "validation error"),
            AppError::NotFound => write!(f, "not found"),
            AppError::Zookeeper => write!(f, "zookeeper error"),
            AppError::SchemaRegistry => write!(f, "schema registry error"),
            AppError::Decode => write!(f, "payload decode error"),
        }
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn displays_a_human_readable_message_per_variant() {
        assert_eq!(AppError::Db.to_string(), "database error");
        assert_eq!(AppError::NotFound.to_string(), "not found");
        assert_eq!(AppError::Zookeeper.to_string(), "zookeeper error");
        assert_eq!(
            AppError::SchemaRegistry.to_string(),
            "schema registry error"
        );
        assert_eq!(AppError::Decode.to_string(), "payload decode error");
    }
}
