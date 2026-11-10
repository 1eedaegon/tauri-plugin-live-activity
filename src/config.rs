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
    /// Watches the app's push-to-start token on iOS 17.2 and later and reports it, new or changed, as a
    /// `live-activity://push-to-start-token` event. Off when absent. Like the receipts, the setting holds for
    /// the process: a kit that already runs with other settings is `CONFLICT`.
    pub push_to_start: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn read(value: Value) -> Result<Option<Config>, serde_json::Error> {
        serde_json::from_value(value)
    }

    // TP-PUSH-3
    #[test]
    fn push_to_start_is_read_from_the_configuration() {
        let on = read(json!({"pushToStart":true})).unwrap().unwrap();
        assert_eq!(on.push_to_start, Some(true));
        assert_eq!(on.receipts, None);
        let off = read(json!({"receipts":"full","pushToStart":false}))
            .unwrap()
            .unwrap();
        assert_eq!(off.push_to_start, Some(false));
        assert_eq!(read(json!({})).unwrap().unwrap().push_to_start, None);
        assert!(read(json!({"pushToStart":"yes"})).is_err());
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
