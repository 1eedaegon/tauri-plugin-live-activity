fn main() {
    // Android devices with 16 KB memory pages load only libraries whose segments are aligned to them, and
    // Android warns about an app that is not. NDK r28 and later align so by default; an earlier NDK needs the flag.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build()
}
