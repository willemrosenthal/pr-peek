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
    AppHandle, LogicalSize, Manager, Theme, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent, Wry,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};

const WINDOW: &str = "main";
const TRAY: &str = "main";
// A click on the tray icon first blurs the open window, which hides it. A toggle this
// soon after leaves it hidden instead of showing it again.
const REOPEN_GUARD: Duration = Duration::from_millis(300);
const DROPDOWN_SIZE: (f64, f64) = (420.0, 600.0);
// The popped out window's size when it opens. The user can resize it after.
const WINDOW_SIZE: (f64, f64) = (480.0, 720.0);

const ICON_PLAIN: &[u8] = include_bytes!("../icons/tray.png");
const ICON_STALE: &[u8] = include_bytes!("../icons/tray-stale.png");
const ICON_FAILING: &[u8] = include_bytes!("../icons/tray-failing.png");

// When the window last hid because it lost focus.
#[derive(Default)]
struct HiddenAt(Mutex<Option<Instant>>);

// True while the dropdown is popped out into a normal window.
#[derive(Default)]
struct PoppedOut(AtomicBool);

fn popped_out(app: &AppHandle) -> bool {
    app.state::<PoppedOut>().0.load(Ordering::Relaxed)
}

// The hosted web app. Dev builds use the local Vite server. PR_PEEK_URL overrides both,
// but only the URLs in capabilities/web-app.json can call the commands below.
fn app_url() -> String {
    let default = if cfg!(debug_assertions) {
        "http://localhost:5173"
    } else {
        "https://www.git-buddy.com"
    };
    std::env::var("PR_PEEK_URL").unwrap_or_else(|_| default.to_string())
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
    // The tray position is only known after the icon is clicked once.
    if !popped_out(window.app_handle())
        && window.move_window(Position::TrayBottomCenter).is_err()
    {
        let _ = window.move_window(Position::TopRight);
    }
    let _ = window.show();
    let _ = window.set_focus();
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

// Opens a web link in the default browser. Other kinds of links are refused.
fn open_web_link(app: &AppHandle, url: &str) -> Result<(), String> {
    let parsed: Url = url.parse().map_err(|_| "not a URL")?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("only web links open".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    log_command("open_external");
    open_web_link(&app, &url)
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

#[tauri::command]
fn quit_app(app: AppHandle) {
    log_command("quit_app");
    app.exit(0);
}

const CLEAR: Color = Color(0, 0, 0, 0);

// --color-page in tokens.css, for light or dark mode.
fn page_color(window: &WebviewWindow) -> Color {
    match window.theme() {
        Ok(Theme::Dark) => Color(17, 17, 19, 255),
        _ => Color(242, 242, 245, 255),
    }
}

#[tauri::command]
fn pop_out(app: AppHandle) -> Result<(), String> {
    log_command("pop_out");
    let window = main_window(&app).ok_or("no window")?;
    set_popped_out(&app, &window, true).map_err(|err| err.to_string())
}

// Turns the dropdown into a normal window you can move and resize, or back. The page
// reloads in the matching shell, and opens on the list.
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
        window.center()?;
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

fn build_tray(app: &AppHandle) -> tauri::Result<CheckMenuItem<Wry>> {
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
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Git Buddy", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&refresh, &open, &settings, &launch, &separator, &quit],
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
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(launch)
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
        .manage(PoppedOut::default())
        .invoke_handler(tauri::generate_handler![
            set_tray_state,
            open_external,
            hide_window,
            quit_app,
            notify,
            launch_at_login,
            set_launch_at_login,
            pop_out
        ])
        .setup(move |app| {
            // No Dock icon. The app lives in the menu bar.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
                    .build()?;

            let handle = app.handle().clone();
            let watched = window.clone();
            window.on_window_event(move |event| match event {
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

            let launch = build_tray(app.handle())?;
            app.manage(LaunchMenuItem(launch));
            launch_at_login_by_default(app.handle());

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
