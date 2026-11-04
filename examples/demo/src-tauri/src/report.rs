use std::{fs, path::Path};

const MAX_REPORT_BYTES: usize = 65_536;

pub fn persist_report(directory: &Path, report: &str) -> Result<String, String> {
    if report.len() > MAX_REPORT_BYTES {
        return Err("Self-test report exceeds 64 KiB".into());
    }
    fs::create_dir_all(directory).map_err(|_| "Could not create the demo report directory")?;
    let path = directory.join("live-activity-self-test.json");
    fs::write(&path, report).map_err(|_| "Could not save the demo report")?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_directory(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "live-activity-report-{}-{name}",
            std::process::id()
        ))
    }

    #[test]
    fn writes_the_report_under_a_fixed_filename() {
        let directory = test_directory("write");
        let path = persist_report(&directory, "{\"status\":\"passed\"}").unwrap();
        assert_eq!(
            std::path::Path::new(&path),
            directory.join("live-activity-self-test.json")
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{\"status\":\"passed\"}"
        );
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn rejects_large_reports_without_creating_a_directory() {
        let directory = test_directory("large");
        assert!(persist_report(&directory, &"x".repeat(65_537)).is_err());
        assert!(!directory.exists());
    }

    #[test]
    fn returns_filesystem_errors_instead_of_claiming_success() {
        let directory = test_directory("file");
        fs::write(&directory, "existing file").unwrap();
        assert!(persist_report(&directory, "{}").is_err());
        assert_eq!(fs::read_to_string(&directory).unwrap(), "existing file");
        fs::remove_file(directory).unwrap();
    }
}
