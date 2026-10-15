//! Profile API keys and the optional dashboard session token live in the OS keychain.
//! The JSON config never stores them.

use std::sync::OnceLock;

const DEFAULT_SERVICE: &str = "com.freezemusic.hermes-overlay";
const DASHBOARD_ACCOUNT: &str = "dashboard-session-token";

static SERVICE_NAME: OnceLock<String> = OnceLock::new();

/// Keychain service follows the bundle identifier, so a `.dev` build cannot overwrite installed keys.
pub fn service_for(identifier: &str) -> String {
    let name = identifier.trim();
    if name.is_empty() {
        DEFAULT_SERVICE.to_string()
    } else {
        name.to_string()
    }
}

pub fn set_service(identifier: &str) {
    let _ = SERVICE_NAME.set(service_for(identifier));
}

fn service() -> &'static str {
    SERVICE_NAME
        .get()
        .map(String::as_str)
        .unwrap_or(DEFAULT_SERVICE)
}

pub enum Lookup {
    Value(String),
    Missing,
}

fn account_for_profile(profile: &str) -> String {
    format!("profile:{profile}")
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service(), account).map_err(|e| format!("鑰匙圈不可用：{e}"))
}

fn classify(err: keyring::Error) -> Result<Lookup, String> {
    match err {
        keyring::Error::NoEntry => Ok(Lookup::Missing),
        other => Err(format!("鑰匙圈錯誤：{other}")),
    }
}

pub fn get_profile_key(profile: &str) -> Result<Lookup, String> {
    match entry(&account_for_profile(profile))?.get_password() {
        Ok(value) => Ok(Lookup::Value(value)),
        Err(err) => classify(err),
    }
}

pub fn set_profile_key(profile: &str, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("金鑰係空".into());
    }
    if key.chars().any(|c| c == '\n' || c == '\r' || c == '\0') {
        return Err("金鑰唔可以有換行".into());
    }
    entry(&account_for_profile(profile))?
        .set_password(key)
        .map_err(|e| format!("寫入鑰匙圈失敗：{e}"))
}

pub fn delete_profile_key(profile: &str) -> Result<(), String> {
    delete_account(&account_for_profile(profile))
}

pub fn get_dashboard_token() -> Result<Lookup, String> {
    match entry(DASHBOARD_ACCOUNT)?.get_password() {
        Ok(value) => Ok(Lookup::Value(value)),
        Err(err) => classify(err),
    }
}

pub fn set_dashboard_token(token: &str) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return delete_dashboard_token();
    }
    if token.chars().any(|c| c == '\n' || c == '\r' || c == '\0') {
        return Err("dashboard token 唔可以有換行".into());
    }
    entry(DASHBOARD_ACCOUNT)?
        .set_password(token)
        .map_err(|e| format!("寫入鑰匙圈失敗：{e}"))
}

pub fn delete_dashboard_token() -> Result<(), String> {
    delete_account(DASHBOARD_ACCOUNT)
}

/// `true` when this process is using keyring's in-memory mock store.
/// That happens if the crate is built without a platform backend feature:
/// `set_password` appears to work, then a later `Entry` cannot see the secret.
pub fn store_is_mock() -> Result<bool, String> {
    let entry = entry("store-kind")?;
    Ok(entry
        .get_credential()
        .downcast_ref::<keyring::mock::MockCredential>()
        .is_some())
}

fn delete_account(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("刪除鑰匙圈項目失敗：{err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyring_service_follows_the_bundle_identifier() {
        assert_eq!(service_for(""), super::DEFAULT_SERVICE);
        assert_eq!(service_for("   "), super::DEFAULT_SERVICE);
        assert_eq!(
            service_for("com.freezemusic.hermes-overlay"),
            "com.freezemusic.hermes-overlay"
        );
        assert_eq!(
            service_for("com.freezemusic.hermes-overlay.dev"),
            "com.freezemusic.hermes-overlay.dev"
        );
    }

    #[test]
    fn platform_backend_is_not_the_mock_store() {
        match store_is_mock() {
            Ok(true) => {
                panic!("keyring resolved to the in-memory mock store; saved API keys will vanish")
            }
            Ok(false) => {}
            Err(err) => {
                assert!(
                    !err.to_lowercase().contains("mock"),
                    "keyring mock store error: {err}"
                );
            }
        }
    }
}
