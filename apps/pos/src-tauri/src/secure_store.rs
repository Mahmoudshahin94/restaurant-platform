//! The staff session's refresh token in the operating system's secure storage (macOS Keychain,
//! Windows Credential Manager, the Linux kernel keyring), so a till restarted mid-shift does not
//! sign its cashier out (ADR 0016). Nothing else is stored, and never in a plain file.

/// PLATFORM_BRAND.app.keychainService (`tools/brand.test.mjs` keeps them equal).
const SERVICE: &str = "app.madar.pos";
const ACCOUNT: &str = "refresh-token";
/// Refresh tokens are short opaque strings; anything larger is not one.
const MAX_TOKEN_LEN: usize = 512;

#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    TooLong,
    Unavailable(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::TooLong => write!(f, "token too long"),
            StoreError::Unavailable(reason) => write!(f, "secure storage unavailable: {reason}"),
        }
    }
}

fn entry() -> Result<keyring::Entry, StoreError> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| StoreError::Unavailable(e.to_string()))
}

/// The stored token, or `None` when there is none.
pub fn read() -> Result<Option<String>, StoreError> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(StoreError::Unavailable(e.to_string())),
    }
}

/// Stores the token, or removes it (`None`, e.g. on sign-out).
pub fn write(token: Option<&str>) -> Result<(), StoreError> {
    let entry = entry()?;
    match token {
        Some(token) if token.len() > MAX_TOKEN_LEN => Err(StoreError::TooLong),
        Some(token) => entry
            .set_password(token)
            .map_err(|e| StoreError::Unavailable(e.to_string())),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(StoreError::Unavailable(e.to_string())),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn use_mock_store() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
    }

    #[test]
    fn rejects_oversized_tokens() {
        use_mock_store();
        let long = "x".repeat(MAX_TOKEN_LEN + 1);
        assert_eq!(write(Some(&long)), Err(StoreError::TooLong));
    }

    #[test]
    fn removing_a_missing_token_is_not_an_error() {
        use_mock_store();
        assert_eq!(write(None), Ok(()));
    }
}
