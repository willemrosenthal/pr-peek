fn main() {
    // Gives each command a permission ("allow-set-tray-state", ...) for capabilities/.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "set_tray_state",
            "open_external",
            "hide_window",
            "notify",
            "launch_at_login",
            "set_launch_at_login",
            "pop_out",
        ]),
    ))
    .expect("tauri-build failed");
}
