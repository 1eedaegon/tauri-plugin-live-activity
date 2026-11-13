use crate::{Error, Result};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    ok: bool,
    data: Option<Value>,
    error: Option<Error>,
}

pub(crate) fn decode<T: DeserializeOwned>(value: Value) -> Result<T> {
    let reply: Reply = serde_json::from_value(value).map_err(|_| Error::native())?;
    match (reply.ok, reply.data, reply.error) {
        (true, Some(data), None) => serde_json::from_value(data).map_err(|_| Error::native()),
        (false, None, Some(error)) => Err(error),
        _ => Err(Error::native()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // TP-ANDROID-12
    #[test]
    fn unwraps_success_and_preserves_stable_native_errors() {
        assert_eq!(
            decode::<Vec<u8>>(json!({"ok":true,"data":[1,2]})).unwrap(),
            [1, 2]
        );
        let error = decode::<Value>(
            json!({"ok":false,"error":{"code":"PERMISSION_DENIED","message":"Disabled"}}),
        )
        .unwrap_err();
        assert_eq!(error.code, "PERMISSION_DENIED");
    }

    // TP-ANDROID-12
    #[test]
    fn malformed_native_replies_fail_closed() {
        for value in [
            json!(null),
            json!({"ok":true}),
            json!({"ok":false}),
            json!({"ok":true,"data":1,"error":{"code":"X","message":"X"}}),
            json!({"ok":false,"data":1}),
            json!({"ok":true,"data":1,"extra":true}),
            json!({"ok":true,"data":"private-value"}),
        ] {
            let error = decode::<u64>(value).unwrap_err();
            assert_eq!(error.code, "NATIVE_ERROR");
            assert!(!error.message.contains("private-value"));
        }
    }

    // TP-ANDROID-12, TP-ANDROID-13
    #[test]
    fn what_the_kotlin_side_answers_reads_into_the_contracts_permissions_and_liveupdates_reply() {
        use crate::{PermissionState, Permissions};
        // The permissions as `permissionsOf` writes them, with each state that Android's dialog leaves.
        for (word, state) in [
            ("granted", PermissionState::Granted),
            ("prompt", PermissionState::Prompt),
            ("settingsRequired", PermissionState::SettingsRequired),
            ("unknown", PermissionState::Unknown),
        ] {
            let permissions: Permissions = decode(json!({"ok":true,"data":{
                "notifications":word,"liveActivities":"notApplicable",
                "promotion":"settingsRequired","frequentPushes":"notApplicable"}}))
            .unwrap();
            assert_eq!(permissions.notifications, state);
            assert_eq!(permissions.live_activities, PermissionState::NotApplicable);
            assert_eq!(permissions.promotion, PermissionState::SettingsRequired);
            assert_eq!(permissions.frequent_pushes, PermissionState::NotApplicable);
        }
        // liveupdate's own reply travels as text, which liveupdate's driver reads.
        let reply: String =
            decode(json!({"ok":true,"data":"{\"status\":\"ok\",\"data\":null}"})).unwrap();
        assert_eq!(reply, r#"{"status":"ok","data":null}"#);
    }
}
