use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::window::Color;
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, Rect, Theme, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_updater::UpdaterExt;

const WINDOW: &str = "main";
const TRAY: &str = "main";
// A click on the tray icon first blurs the open window, which hides it. A toggle this
// soon after leaves it hidden instead of showing it again.
const REOPEN_GUARD: Duration = Duration::from_millis(300);
// How long after a Cmd+click the browser may take focus without hiding the dropdown.
const LINK_GUARD: Duration = Duration::from_millis(1500);
// Wait for the browser to finish coming forward before taking focus back.
const REFOCUS_DELAY: Duration = Duration::from_millis(150);
const HEIGHT: f64 = 720.0;
const DROPDOWN_SIZE: (f64, f64) = (420.0, HEIGHT);
// The popped out window's size when it opens. The user can resize it after.
const WINDOW_SIZE: (f64, f64) = (480.0, HEIGHT);
// Space between the menu bar and the top of the dropdown.
const MENU_BAR_GAP: f64 = 12.0;
const UPDATE_CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

const ICON_PLAIN: &[u8] = include_bytes!("../icons/tray.png");
const ICON_STALE: &[u8] = include_bytes!("../icons/tray-stale.png");
const ICON_FAILING: &[u8] = include_bytes!("../icons/tray-failing.png");

// When the window last hid because it lost focus.
#[derive(Default)]
struct HiddenAt(Mutex<Option<Instant>>);

// When a link last opened in the background.
#[derive(Default)]
struct LinkOpenedAt(Mutex<Option<Instant>>);

fn just_opened_link(app: &AppHandle) -> bool {
    app.state::<LinkOpenedAt>()
        .0
        .lock()
        .ok()
        .and_then(|at| *at)
        .is_some_and(|at| at.elapsed() < LINK_GUARD)
}

// Takes focus back from the browser, after it has come forward. Skipped if the window
// hid meanwhile, since focusing would show it again.
fn refocus_soon(window: &WebviewWindow) {
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(REFOCUS_DELAY);
        if window.is_visible().unwrap_or(false) {
            let _ = window.set_focus();
        }
    });
}

// Where the tray icon was at its last click.
#[derive(Default)]
struct IconRect(Mutex<Option<Rect>>);

// True while the dropdown is popped out into a normal window.
#[derive(Default)]
struct PoppedOut(AtomicBool);

fn popped_out(app: &AppHandle) -> bool {
    app.state::<PoppedOut>().0.load(Ordering::Relaxed)
}

// The local Vite server, which dev builds load instead of the hosted web app.
const DEV_SERVER: &str = "http://localhost:5173";

// The hosted web app. Release builds always load it. Dev builds load the local Vite
// server, or PR_PEEK_URL when set. Only the URLs in capabilities/web-app.json, plus the
// dev server in dev builds (dev_server_capability), can call the commands below.
fn app_url() -> String {
    if cfg!(debug_assertions) {
        std::env::var("PR_PEEK_URL").unwrap_or_else(|_| DEV_SERVER.to_string())
    } else {
        "https://www.git-buddy.com".to_string()
    }
}

// capabilities/web-app.json, for the dev server instead. Only dev builds add it, so a
// page on localhost can never call the commands in a release.
fn dev_server_capability() -> String {
    let mut capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/web-app.json"))
            .expect("web-app.json is valid JSON");
    capability["identifier"] = "dev-server".into();
    capability["remote"]["urls"] = serde_json::json!([format!("{DEV_SERVER}/*")]);
    capability.to_string()
}

// A page of the web app, like "/" or "/settings", in the dropdown or the popped out
// window. The page styles itself to match.
fn app_page(path: &str, popped: bool) -> Url {
    let shell = if popped { "window" } else { "tray" };
    format!("{}{path}?shell={shell}", app_url())
        .parse()
        .expect("the app URL is valid")
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW)
}

// Fires a DOM event, `pr-peek:<name>`, in the page. desktop.ts listens for these.
fn tell_page(window: &WebviewWindow, name: &str) {
    let _ = window.eval(format!("window.dispatchEvent(new Event('pr-peek:{name}'))"));
}

// Shows the window and focuses it. The dropdown moves under the tray icon. A popped out
// window stays where the user put it.
fn show_window(window: &WebviewWindow) {
    if !popped_out(window.app_handle()) {
        place_under_icon(window);
    }
    let _ = window.show();
    let _ = window.set_focus();
    tell_page(window, "shown");
}

// Centers the dropdown under the tray icon, a little below the menu bar. Before the
// first click, it goes to the top right.
fn place_under_icon(window: &WebviewWindow) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let icon = window
        .state::<IconRect>()
        .0
        .lock()
        .ok()
        .and_then(|rect| *rect);
    let (Some(icon), Ok(size)) = (icon, window.outer_size()) else {
        let _ = window.move_window(Position::TopRight);
        return;
    };
    let at = icon.position.to_physical::<f64>(scale);
    let icon_size = icon.size.to_physical::<f64>(scale);
    let x = at.x + icon_size.width / 2.0 - f64::from(size.width) / 2.0;
    let y = at.y + icon_size.height + MENU_BAR_GAP * scale;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

// Every hide goes through here, so the page always hears about it.
fn hide(window: &WebviewWindow) {
    let _ = window.hide();
    tell_page(window, "hidden");
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    // A popped out window comes to the front instead of hiding.
    if popped_out(app) {
        show_window(&window);
        return;
    }
    if window.is_visible().unwrap_or(false) {
        hide(&window);
        return;
    }
    let hidden_at = app.state::<HiddenAt>();
    let just_hidden = hidden_at
        .0
        .lock()
        .ok()
        .and_then(|at| *at)
        .is_some_and(|at| at.elapsed() < REOPEN_GUARD);
    if !just_hidden {
        show_window(&window);
    }
}

fn log_command(name: &str) {
    if cfg!(debug_assertions) {
        eprintln!("pr-peek: {name}");
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum TrayIcon {
    Plain,
    Stale,
    Failing,
}

// What the tray shows: the text next to the icon, and which icon.
#[derive(Deserialize)]
struct TrayState {
    title: String,
    icon: TrayIcon,
}

#[tauri::command]
fn set_tray_state(app: AppHandle, state: TrayState) -> Result<(), String> {
    log_command(&format!("set_tray_state {:?}", state.title));
    let tray = app.tray_by_id(TRAY).ok_or("no tray icon")?;
    // Colored icons aren't templates, so macOS doesn't tint them.
    let (bytes, template) = match state.icon {
        TrayIcon::Plain => (ICON_PLAIN, true),
        TrayIcon::Stale => (ICON_STALE, false),
        TrayIcon::Failing => (ICON_FAILING, false),
    };
    let icon = Image::from_bytes(bytes).map_err(|err| err.to_string())?;
    tray.set_icon(Some(icon)).map_err(|err| err.to_string())?;
    tray.set_icon_as_template(template)
        .map_err(|err| err.to_string())?;
    tray.set_title(Some(state.title))
        .map_err(|err| err.to_string())
}

// Only web links open. Other kinds are refused.
fn web_link(url: &str) -> Result<Url, String> {
    let parsed: Url = url.parse().map_err(|_| "not a URL")?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("only web links open".into());
    }
    Ok(parsed)
}

// Opens a web link in the default browser.
fn open_web_link(app: &AppHandle, url: &str) -> Result<(), String> {
    app.opener()
        .open_url(web_link(url)?.as_str(), None::<&str>)
        .map_err(|err| err.to_string())
}

// Opens a web link and asks the browser to stay behind. Some browsers, like Chrome, come
// forward anyway, so the window takes focus back (see `just_opened_link`).
fn open_in_background(app: &AppHandle, url: &str) -> Result<(), String> {
    if let Ok(mut at) = app.state::<LinkOpenedAt>().0.lock() {
        *at = Some(Instant::now());
    }
    let status = std::process::Command::new("open")
        .arg("-g")
        .arg(web_link(url)?.as_str())
        .status()
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("couldn't open the link".into())
    }
}

// `background` is for Cmd+click. Older pages leave it out.
#[tauri::command]
fn open_external(app: AppHandle, url: String, background: Option<bool>) -> Result<(), String> {
    log_command("open_external");
    if background == Some(true) {
        open_in_background(&app, &url)
    } else {
        open_web_link(&app, &url)
    }
}

// A notification from the server, with the link a click opens.
#[derive(Deserialize)]
struct Alert {
    title: String,
    body: String,
    url: String,
}

#[tauri::command]
fn notify(app: AppHandle, alert: Alert) -> Result<(), String> {
    log_command(&format!("notify {:?}", alert.title));
    app.notification()
        .builder()
        .title(alert.title)
        .body(alert.body)
        .extra("url", alert.url)
        .show()
        .map_err(|err| err.to_string())
}

// A click on a notification opens its PR in the browser. Links within pr-peek, like the
// morning summary's, open the dropdown instead.
fn on_notification_click(app: &AppHandle, url: Option<&str>) {
    let opened = url.is_some_and(|url| open_web_link(app, url).is_ok());
    if !opened {
        if let Some(window) = main_window(app) {
            show_window(&window);
        }
    }
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    log_command("hide_window");
    if let Some(window) = main_window(&app) {
        hide(&window);
    }
}

const CLEAR: Color = Color(0, 0, 0, 0);

// --color-page in tokens.css, for light or dark mode.
fn page_color(window: &WebviewWindow) -> Color {
    match window.theme() {
        Ok(Theme::Dark) => Color(17, 17, 19, 255),
        _ => Color(242, 242, 245, 255),
    }
}

// Called while the user drags the dropdown's header. The new window keeps following the
// pointer until they let go.
#[tauri::command]
fn pop_out(app: AppHandle) -> Result<(), String> {
    log_command("pop_out");
    let window = main_window(&app).ok_or("no window")?;
    set_popped_out(&app, &window, true).map_err(|err| err.to_string())?;
    window.start_dragging().map_err(|err| err.to_string())
}

// Turns the dropdown into a normal window you can move and resize, or back. The window
// stays where it is. The page reloads in the matching shell, and opens on the list.
fn set_popped_out(app: &AppHandle, window: &WebviewWindow, popped: bool) -> tauri::Result<()> {
    app.state::<PoppedOut>().0.store(popped, Ordering::Relaxed);
    window.set_always_on_top(!popped)?;
    window.set_decorations(popped)?;
    window.set_resizable(popped)?;
    // The title bar shows the window's color, so the popped out window needs a solid one.
    let color = if popped { page_color(window) } else { CLEAR };
    window.set_background_color(Some(color))?;
    let (width, height) = if popped { WINDOW_SIZE } else { DROPDOWN_SIZE };
    window.set_size(LogicalSize::new(width, height))?;
    window.navigate(app_page("/", popped))?;
    if popped {
        show_window(window);
    } else {
        hide(window);
    }
    Ok(())
}

// The "Launch at login" menu item, kept in step with the setting.
struct LaunchMenuItem(CheckMenuItem<Wry>);

fn launch_at_login_on(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

// Turns launch at login on or off, and ticks the menu item to match.
fn apply_launch_at_login(app: &AppHandle, on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if on {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|err| err.to_string())?;
    if let Some(item) = app.try_state::<LaunchMenuItem>() {
        let _ = item.0.set_checked(on);
    }
    Ok(())
}

#[tauri::command]
fn launch_at_login(app: AppHandle) -> bool {
    log_command("launch_at_login");
    launch_at_login_on(&app)
}

#[tauri::command]
fn set_launch_at_login(app: AppHandle, on: bool) -> Result<(), String> {
    log_command("set_launch_at_login");
    apply_launch_at_login(&app, on)
}

// On by default: turned on the first time the installed app runs, once. Dev builds and
// copies outside Applications are skipped, since the login item points at this copy.
fn launch_at_login_by_default(app: &AppHandle) {
    let installed = std::env::current_exe().is_ok_and(|exe| exe.starts_with("/Applications"));
    if cfg!(debug_assertions) || !installed {
        return;
    }
    replace_old_login_item(app);
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = dir.join("launch-at-login-set");
    if marker.exists() {
        return;
    }
    if apply_launch_at_login(app, true).is_ok() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker, "");
    }
}

// The app used to be called pr-peek. Its login item has that name and opens the old app,
// so it's swapped for one that opens this copy.
fn replace_old_login_item(app: &AppHandle) {
    let Ok(home) = app.path().home_dir() else {
        return;
    };
    let old = home.join("Library/LaunchAgents/pr-peek.plist");
    if std::fs::remove_file(old).is_ok() {
        let _ = apply_launch_at_login(app, true);
    }
}

// Updates. A new version downloads and installs in the background, then waits for a
// restart. Until then the app keeps running the old version.
#[derive(Default)]
struct Updates {
    checking: AtomicBool,
    ready: AtomicBool,
}

// The "Check for updates" menu item. It's greyed out during a check, and becomes
// "Restart to update" once an update is ready.
struct UpdateMenuItem(MenuItem<Wry>);

fn set_update_menu_item(app: &AppHandle, text: &str, enabled: bool) {
    if let Some(item) = app.try_state::<UpdateMenuItem>() {
        let _ = item.0.set_text(text);
        let _ = item.0.set_enabled(enabled);
    }
}

fn update_is_ready(app: &AppHandle) -> bool {
    app.state::<Updates>().ready.load(Ordering::Relaxed)
}

// What a check found.
enum UpdateCheck {
    Ready,
    UpToDate,
    Busy,
}

// Looks for a newer version and installs it. Releases come from this repo's GitHub
// Releases (`plugins.updater` in tauri.conf.json), signed with our updater key. Blocks
// until done, so it runs on its own thread.
fn install_update(app: &AppHandle) -> Result<UpdateCheck, String> {
    if update_is_ready(app) {
        return Ok(UpdateCheck::Ready);
    }
    let updates = app.state::<Updates>();
    if updates.checking.swap(true, Ordering::Relaxed) {
        return Ok(UpdateCheck::Busy);
    }
    set_update_menu_item(app, "Checking for updates…", false);
    let result = tauri::async_runtime::block_on(download_and_install(app));
    updates.checking.store(false, Ordering::Relaxed);
    match result {
        Ok(true) => {
            updates.ready.store(true, Ordering::Relaxed);
            set_update_menu_item(app, "Restart to update", true);
            if let Some(window) = main_window(app) {
                tell_page(&window, "update-ready");
            }
            Ok(UpdateCheck::Ready)
        }
        Ok(false) => {
            set_update_menu_item(app, "Check for updates", true);
            Ok(UpdateCheck::UpToDate)
        }
        Err(err) => {
            eprintln!("pr-peek: couldn't check for updates: {err}");
            set_update_menu_item(app, "Check for updates", true);
            Err(err)
        }
    }
}

// True if there was an update to install.
async fn download_and_install(app: &AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|err| err.to_string())?;
    let Some(update) = updater.check().await.map_err(|err| err.to_string())? else {
        return Ok(false);
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| err.to_string())?;
    Ok(true)
}

// Checks on launch and every 6 hours, until an update is ready. Dev builds don't, so
// they never replace themselves with a release.
fn check_for_updates_regularly(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        while !matches!(install_update(&app), Ok(UpdateCheck::Ready)) {
            std::thread::sleep(UPDATE_CHECK_EVERY);
        }
    });
}

// A notification that answers "Check for updates". Clicking it opens the dropdown.
fn tell_user(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

// The menu item. Restarts if an update is ready, or checks now and says what it found.
fn check_for_updates_now(app: &AppHandle) {
    if update_is_ready(app) {
        app.restart();
    }
    if cfg!(debug_assertions) {
        tell_user(
            app,
            "Updates are off",
            "Dev builds don't update themselves.",
        );
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || match install_update(&app) {
        // The menu item and the dropdown say so.
        Ok(UpdateCheck::Ready) | Ok(UpdateCheck::Busy) => {}
        Ok(UpdateCheck::UpToDate) => {
            let version = app.package_info().version.to_string();
            tell_user(
                &app,
                "Git Buddy is up to date",
                &format!("Version {version}"),
            );
        }
        Err(_) => tell_user(&app, "Couldn't check for updates", "Try again later."),
    });
}

#[tauri::command]
fn update_ready(app: AppHandle) -> bool {
    log_command("update_ready");
    update_is_ready(&app)
}

// Opens the new version. Does nothing until one is ready.
#[tauri::command]
fn restart_to_update(app: AppHandle) {
    log_command("restart_to_update");
    if update_is_ready(&app) {
        app.restart();
    }
}

struct TrayMenuItems {
    launch: CheckMenuItem<Wry>,
    update: MenuItem<Wry>,
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayMenuItems> {
    // Greyed out, just to show which version is running. Release builds get it from the
    // tag (docs/15-auto-release.md). Dev builds say 0.0.0.
    let version = MenuItem::with_id(
        app,
        "version",
        format!("Git Buddy {}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let version_separator = PredefinedMenuItem::separator(app)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open in browser", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let launch = CheckMenuItem::with_id(
        app,
        "launch",
        "Launch at login",
        true,
        launch_at_login_on(app),
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Git Buddy", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &version,
            &version_separator,
            &refresh,
            &open,
            &settings,
            &launch,
            &update,
            &separator,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY)
        .icon(Image::from_bytes(ICON_PLAIN)?)
        // macOS tints a template image to match light and dark menu bars.
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "refresh" => {
                if let Some(window) = main_window(app) {
                    tell_page(&window, "refresh");
                }
            }
            "open" => {
                let _ = app
                    .opener()
                    .open_url(format!("{}/", app_url()), None::<&str>);
            }
            "settings" => {
                if let Some(window) = main_window(app) {
                    let _ = window.navigate(app_page("/settings", popped_out(app)));
                    show_window(&window);
                }
            }
            "launch" => {
                // Flips the real setting, whatever the checkbox shows.
                let _ = apply_launch_at_login(app, !launch_at_login_on(app));
            }
            "update" => check_for_updates_now(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Ok(mut icon) = app.state::<IconRect>().0.lock() {
                    *icon = Some(rect);
                }
                toggle_window(app);
            }
        })
        .build(app)?;
    Ok(TrayMenuItems { launch, update })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Option+Command+P toggles the window.
    let toggle_shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::KeyP);

    tauri::Builder::default()
        // Opening pr-peek again shows the running one instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = main_window(app) {
                show_window(&window);
            }
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if *shortcut == toggle_shortcut && event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .manage(HiddenAt::default())
        .manage(IconRect::default())
        .manage(LinkOpenedAt::default())
        .manage(PoppedOut::default())
        .manage(Updates::default())
        .invoke_handler(tauri::generate_handler![
            set_tray_state,
            open_external,
            hide_window,
            notify,
            launch_at_login,
            set_launch_at_login,
            pop_out,
            update_ready,
            restart_to_update
        ])
        .setup(move |app| {
            // No Dock icon. The app lives in the menu bar.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if cfg!(debug_assertions) {
                app.add_capability(dev_server_capability())?;
            }

            let window =
                WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::External(app_page("/", false)))
                    .title("Git Buddy")
                    .inner_size(DROPDOWN_SIZE.0, DROPDOWN_SIZE.1)
                    .resizable(false)
                    .decorations(false)
                    // See-through, so the page can round its corners.
                    .transparent(true)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    // Keeps the live stream and timers running while hidden.
                    .background_throttling(BackgroundThrottlingPolicy::Disabled)
                    // Lets the page take a dropped PR link. Tauri's own handler would
                    // catch drops for its file drop events, which we don't use.
                    .disable_drag_drop_handler()
                    .build()?;

            let handle = app.handle().clone();
            let watched = window.clone();
            window.on_window_event(move |event| match event {
                // Right after a Cmd+click, the browser took focus. Take it back.
                WindowEvent::Focused(false) if just_opened_link(&handle) => {
                    refocus_soon(&watched);
                }
                // The dropdown hides like a menu when the user clicks elsewhere.
                WindowEvent::Focused(false) if !popped_out(&handle) => {
                    hide(&watched);
                    if let Ok(mut at) = handle.state::<HiddenAt>().0.lock() {
                        *at = Some(Instant::now());
                    }
                }
                // Closing the popped out window puts it back under the icon.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = set_popped_out(&handle, &watched, false);
                }
                _ => {}
            });

            let items = build_tray(app.handle())?;
            app.manage(LaunchMenuItem(items.launch));
            app.manage(UpdateMenuItem(items.update));
            launch_at_login_by_default(app.handle());
            check_for_updates_regularly(app.handle());

            let clicked = app.handle().clone();
            app.notification().on_action(move |action| {
                // A click on the notification itself, not on one of its buttons.
                if action.action_id() != "tap" {
                    return;
                }
                let url = action
                    .notification()
                    .and_then(|shown| shown.extra().get("url"))
                    .and_then(|url| url.as_str());
                on_notification_click(&clicked, url);
            })?;

            // Another app may own the shortcut. The tray icon still works without it.
            if let Err(err) = app.global_shortcut().register(toggle_shortcut) {
                eprintln!("pr-peek: couldn't register Option+Command+P: {err}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("pr-peek failed to start");
}
