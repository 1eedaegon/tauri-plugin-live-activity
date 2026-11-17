//! The requests that the plugin's TypeScript builds, judged by the checks that the plugin's commands run. The plugin
//! has no validator in JavaScript: the node tests that build requests keep them, as the JSON that crosses the IPC, in
//! the files of tests/fixtures/typescript (tests/typescript-requests.ts), and a request that changes fails its test
//! there until its file is written again. Every request of every file is judged here.

use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};
use tauri_plugin_live_activity::{
    LayoutEndInput, LayoutStartInput, LayoutUpdateInput, Validate, parse_request, validate_request,
};

/// The commands whose requests the checks judge.
const COMMANDS: [&str; 6] = [
    "start",
    "update",
    "end",
    "start_layout",
    "update_layout",
    "end_layout",
];

/// One request of a file. The checks take it, or refuse it with `code`. One that comes `after` a start of its file
/// is a request on its own first, and is then judged against that start as the native layer judges it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    name: String,
    command: String,
    input: Value,
    after: Option<String>,
    code: Option<String>,
}

/// The JSON files of tests/fixtures/typescript, each with its cases, in the order of their names.
fn files() -> Vec<(String, Vec<Case>)> {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/typescript");
    let entries =
        fs::read_dir(&folder).unwrap_or_else(|error| panic!("{}: {error}", folder.display()));
    let mut paths: Vec<_> = entries
        .map(|entry| entry.unwrap_or_else(|error| panic!("{}: {error}", folder.display())))
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|json| json == "json"))
        .collect();
    paths.sort();
    paths
        .iter()
        .map(|path| {
            let file = path.file_name().unwrap().to_string_lossy().into_owned();
            let text = fs::read(path).unwrap_or_else(|error| panic!("{file}: {error}"));
            let cases =
                serde_json::from_slice(&text).unwrap_or_else(|error| panic!("{file}: {error}"));
            (file, cases)
        })
        .collect()
}

/// A request that the checks have taken, as the type of its command.
fn typed<T: DeserializeOwned + Validate>(label: &str, command: &str, input: &Value) -> T {
    parse_request(command, input.clone()).unwrap_or_else(|error| panic!("{label}: {error}"))
}

/// What the checks say of `case`, which `label` names: nothing when they take it, else the code of the refusal.
/// `starts` are the starts of its file that came before it and were taken, by name.
fn verdict(label: &str, case: &Case, starts: &BTreeMap<&str, &Value>) -> Option<String> {
    let command = case.command.as_str();
    // The checks refuse an unknown command as they refuse a wrong request, so a case that is to be refused would
    // pass with a misspelt one.
    assert!(COMMANDS.contains(&command), "{label}: no command {command}");
    let alone = validate_request(command, case.input.clone());
    let Some(after) = &case.after else {
        return alone.err().map(|error| error.code);
    };
    let follows = matches!(command, "update_layout" | "end_layout");
    assert!(
        follows,
        "{label}: only an update or an end of a layout follows a start"
    );
    assert_eq!(
        alone,
        Ok(()),
        "{label}: refused on its own, though it follows a start"
    );
    let start = starts
        .get(after.as_str())
        .unwrap_or_else(|| panic!("{label}: no start before it is named {after:?}"));
    let start: LayoutStartInput = typed(label, "start_layout", start);
    let against = if command == "update_layout" {
        start.validate_update(&typed::<LayoutUpdateInput>(label, command, &case.input))
    } else {
        start.validate_end(&typed::<LayoutEndInput>(label, command, &case.input))
    };
    against.err().map(|error| error.code)
}

// TP-CONTRACT-9, TP-JSX-5
#[test]
fn every_request_built_in_typescript_gets_its_verdict_from_the_checks_of_the_commands() {
    let files = files();
    assert!(!files.is_empty(), "tests/fixtures/typescript holds no file");
    for (file, cases) in &files {
        assert!(!cases.is_empty(), "{file} holds no request");
        let mut names = BTreeSet::new();
        let mut starts = BTreeMap::new();
        for case in cases {
            let label = format!("{file}: {}", case.name);
            assert!(names.insert(&case.name), "{label}: the name is there twice");
            assert_eq!(verdict(&label, case, &starts), case.code, "{label}");
            if case.command == "start_layout" && case.code.is_none() {
                starts.insert(case.name.as_str(), &case.input);
            }
        }
    }
    // The checks refuse as well as take, a request on its own and an update or an end after its start: a judge that
    // took whatever it was given would fail on these, and files without one of them would leave a way untried.
    let all = || files.iter().flat_map(|(_, cases)| cases);
    let refused_alone = all().any(|case| case.after.is_none() && case.code.is_some());
    assert!(refused_alone, "no request is refused on its own");
    for command in ["update_layout", "end_layout"] {
        let following = || all().filter(|case| case.after.is_some() && case.command == command);
        let refused = following().any(|case| case.code.is_some());
        let taken = following().any(|case| case.code.is_none());
        assert!(refused, "no {command} is refused after its start");
        assert!(taken, "no {command} is taken after its start");
    }
}
