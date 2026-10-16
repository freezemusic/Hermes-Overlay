//! Profile API keys and the optional dashboard session token live in the OS keychain.
//! The JSON config never stores them.
//!
//! `sync-secret-service` `get_password` blocks until the collection unlocks.
//! Called on the GTK thread, that freezes the overlay, ignores SIGTERM, and
//! stays stuck after the prompt is cancelled. Reads run on a worker with a
//! short timeout so a locked keyring becomes a banner instead of a hang.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::thread;
use std::time::Duration;

const DEFAULT_SERVICE: &str = "com.freezemusic.hermes-overlay";
const DASHBOARD_ACCOUNT: &str = "dashboard-session-token";

static SERVICE_NAME: OnceLock<String> = OnceLock::new();

#[cfg(test)]
static TEST_KEYRING: std::sync::Mutex<()> = std::sync::Mutex::new(());

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

const KEYRING_TIMEOUT: Duration = Duration::from_secs(3);

/// Set when a read did not return before the timeout. Later reads fail
/// immediately until that worker finishes, so one locked prompt cannot
/// queue a 3s wait per profile.
static KEYRING_STUCK: AtomicBool = AtomicBool::new(false);

fn keyring_unavailable() -> String {
    "鑰匙圈錯誤：鎖定或者未有回應。請解鎖之後再試。".into()
}

fn keyring_worker() -> &'static mpsc::Sender<Box<dyn FnOnce() + Send>> {
    static TX: OnceLock<mpsc::Sender<Box<dyn FnOnce() + Send>>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Box<dyn FnOnce() + Send>>();
        let _ = thread::Builder::new().name("keyring".into()).spawn(move || {
            while let Ok(job) = rx.recv() {
                job();
            }
        });
        tx
    })
}

/// Run one keyring read off the caller. `get_password` blocks until the
/// Secret Service collection unlocks; on the GTK thread that freezes the
/// overlay and ignores SIGTERM. The caller waits at most `timeout`.
fn run_keyring<T: Send + 'static>(
    timeout: Duration,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    if KEYRING_STUCK.load(Ordering::Acquire) {
        return Err(keyring_unavailable());
    }
    let (tx, rx) = mpsc::channel();
    let done = Arc::new(AtomicBool::new(false));
    let finished = Arc::clone(&done);
    let sent = keyring_worker().send(Box::new(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
        // Publish completion before clearing the stuck flag, so a caller that
        // already timed out cannot leave the flag set after this job ends.
        finished.store(true, Ordering::Release);
        KEYRING_STUCK.store(false, Ordering::Release);
        let _ = tx.send(match result {
            Ok(value) => value,
            Err(_) => Err("鑰匙圈錯誤：讀取中斷。".into()),
        });
    }));
    if sent.is_err() {
        return Err("鑰匙圈錯誤：讀取開唔到。".into());
    }
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            KEYRING_STUCK.store(true, Ordering::Release);
            if done.load(Ordering::Acquire) {
                KEYRING_STUCK.store(false, Ordering::Release);
            }
            Err(keyring_unavailable())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("鑰匙圈錯誤：讀取中斷。".into()),
    }
}

fn read_password(account: &str) -> Result<Lookup, String> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Lookup::Value(value)),
        Err(err) => classify(err),
    }
}

pub fn get_profile_key(profile: &str) -> Result<Lookup, String> {
    let account = account_for_profile(profile);
    run_keyring(KEYRING_TIMEOUT, move || read_password(&account))
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
    run_keyring(KEYRING_TIMEOUT, || read_password(DASHBOARD_ACCOUNT))
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
    run_keyring(KEYRING_TIMEOUT, || {
        let entry = entry("store-kind")?;
        Ok(entry
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .is_some())
    })
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
    fn a_slow_keyring_read_returns_before_the_prompt_can_hang_the_app() {
        let _guard = super::TEST_KEYRING.lock().unwrap_or_else(|err| err.into_inner());
        let started = std::time::Instant::now();
        let result: Result<String, String> = run_keyring(Duration::from_millis(40), || {
            thread::sleep(Duration::from_millis(400));
            Ok("secret".to_string())
        });
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "timed out too late: {:?}",
            started.elapsed()
        );
        let err = result.expect_err("slow read");
        assert!(err.contains("鑰匙圈錯誤"), "{err}");
        let again = std::time::Instant::now();
        let blocked: Result<String, String> =
            run_keyring(Duration::from_millis(80), || Ok("later".to_string()));
        assert!(
            again.elapsed() < Duration::from_millis(200),
            "a queued read waited on the stuck prompt: {:?}",
            again.elapsed()
        );
        assert!(blocked.is_err(), "a read behind a stuck prompt must time out");
        thread::sleep(Duration::from_millis(450));
    }

    #[test]
    fn a_fast_keyring_read_returns_the_value() {
        let _guard = super::TEST_KEYRING.lock().unwrap_or_else(|err| err.into_inner());
        let result: Result<String, String> =
            run_keyring(Duration::from_millis(200), || Ok("ok".to_string()));
        assert_eq!(result.expect("fast read"), "ok");
    }

    #[test]
    fn platform_backend_is_not_the_mock_store() {
        let _guard = super::TEST_KEYRING.lock().unwrap_or_else(|err| err.into_inner());
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
