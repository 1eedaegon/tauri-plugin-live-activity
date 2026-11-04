use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

/// Stable errors shared by the Rust, JavaScript, and native interfaces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[error("{code}: {message}")]
pub struct Error {
    pub code: String,
    pub message: String,
}

impl Error {
    pub fn invalid() -> Self {
        Self::new(
            "INVALID_INPUT",
            "Request does not match the live activity contract",
        )
    }

    pub fn unsupported() -> Self {
        Self::new(
            "UNSUPPORTED_PLATFORM",
            "This release supports native activities on iOS and Android only",
        )
    }

    #[cfg(any(mobile, test))]
    pub(crate) fn native() -> Self {
        Self::new(
            "NATIVE_ERROR",
            "The native activity backend could not complete the request",
        )
    }

    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
