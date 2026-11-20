//! Android: where the plugin keeps its files. The Kotlin side answers the folder of the app's files, and Rust alone
//! names what the plugin keeps under it.

use liveactivity::android::AndroidFiles;
use serde::Deserialize;
use std::path::PathBuf;

/// The files of the plugin under the folder of the app's files, as every version of the plugin has named them.
const LAYOUT_STORE: &str = "tauri-live-activity/layouts.json";
const IMAGE_FOLDER: &str = "tauri-live-activity/images";

/// The answer of the Kotlin side's `filesDirectory`: the folder of the app's files (`Context.getFilesDir()`).
#[derive(Deserialize)]
pub(crate) struct FilesDirectory {
    path: PathBuf,
}

impl FilesDirectory {
    /// The folder of the app's files as the app names it itself, for a client of a service (`crate::native`).
    #[cfg(target_os = "android")]
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// What liveactivity's Android backend is told of the files: the folder as the Kotlin side answered it, and
    /// under it the plugin's own names for the layouts and for the pictures of `writeImage`.
    pub(crate) fn for_app(self, app_name: String, samsung_now_bar: bool) -> AndroidFiles {
        AndroidFiles {
            layout_store: LAYOUT_STORE.into(),
            image_folder: IMAGE_FOLDER.into(),
            samsung_now_bar,
            ..AndroidFiles::new(app_name, self.path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // TP-ANDROID-11
    #[test]
    fn the_plugins_files_keep_their_names_under_the_folder_that_the_kotlin_side_answers() {
        let reply = json!({"ok": true, "data": {"path": "/data/user/0/io.example.app/files"}});
        let directory: FilesDirectory = crate::bridge::decode(reply).unwrap();

        // An app that updates the plugin finds its running layouts and its pictures where they were: the names
        // are those of every version, and not liveactivity's defaults.
        assert_eq!(
            directory.for_app("Mochi".into(), true),
            AndroidFiles {
                app_name: "Mochi".into(),
                files: "/data/user/0/io.example.app/files".into(),
                layout_store: "tauri-live-activity/layouts.json".into(),
                image_folder: "tauri-live-activity/images".into(),
                samsung_now_bar: true,
            }
        );
    }
}
