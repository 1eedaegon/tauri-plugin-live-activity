use serde::Deserialize;

/// What the native receipt store keeps of an accepted snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Receipts {
    /// The snapshot itself (the default).
    Full,
    /// Only the SHA-256 digest of the snapshot. A digest hides a snapshot only while it cannot be
    /// guessed: hashing candidates recovers a snapshot made only of guessable values, such as a
    /// flag, a small number or a short word.
    Redacted,
}

/// Options that only the Android backend reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AndroidConfig {
    /// Adds Samsung One UI's Now Bar text extras to layout notifications on Android 17 and later,
    /// so the Now Bar shows the body. Off when absent. It does not put the app on Samsung's
    /// allow-list; see docs/android-integration.md.
    pub samsung_now_bar: Option<bool>,
}

/// `plugins.live-activity` in the Tauri configuration. The native side reads the same object.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub receipts: Option<Receipts>,
    pub android: Option<AndroidConfig>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn read(value: Value) -> Result<Option<Config>, serde_json::Error> {
        serde_json::from_value(value)
    }

    // TP-CONFIG-1
    #[test]
    fn the_android_options_are_optional_and_strict() {
        let on = read(json!({"android":{"samsungNowBar":true}}))
            .unwrap()
            .unwrap();
        assert_eq!(
            on.android,
            Some(AndroidConfig {
                samsung_now_bar: Some(true)
            })
        );
        let both = read(json!({"receipts":"redacted","android":{}}))
            .unwrap()
            .unwrap();
        assert_eq!(both.receipts, Some(Receipts::Redacted));
        assert_eq!(both.android.unwrap().samsung_now_bar, None);
        assert_eq!(read(json!({})).unwrap().unwrap().android, None);
        for value in [
            json!({"android":{"samsungNowbar":true}}),
            json!({"android":{"samsungNowBar":"true"}}),
            json!({"android":{"samsungNowBar":true,"other":1}}),
            json!({"android":true}),
        ] {
            assert!(read(value.clone()).is_err(), "{value}");
        }
    }
}
