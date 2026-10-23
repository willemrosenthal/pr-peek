use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};

const WINDOW: &str = "main";
const TRAY: &str = "main";
// A click on the tray icon first blurs the open window, which hides it. A toggle this
// soon after leaves it hidden instead of showing it again.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

const ICON_PLAIN: &[u8] = include_bytes!("../icons/tray.png");
const ICON_STALE: &[u8] = include_bytes!("../icons/tray-stale.png");
const ICON_FAILING: &[u8] = include_bytes!("../icons/tray-failing.png");

// When the window last hid because it lost focus.
#[derive(Default)]
struct HiddenAt(Mutex<Option<Instant>>);

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

// A page of the web app in tray mode, like "/" or "/settings".
fn tray_page(path: &str) -> Url {
    format!("{}{path}?shell=tray", app_url())
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

// Shows the window under the tray icon and focuses it.
fn show_window(window: &WebviewWindow) {
    // The tray position is only known after the icon is clicked once.
    if window.move_window(Position::TrayBottomCenter).is_err() {
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
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    log_command("open_external");
    let parsed: Url = url.parse().map_err(|_| "not a URL")?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("only web links open".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|err| err.to_string())
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

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open in browser", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit pr-peek", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&refresh, &open, &settings, &separator, &quit])?;

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
                    let _ = window.navigate(tray_page("/settings"));
                    show_window(&window);
                }
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
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            set_tray_state,
            open_external,
            hide_window,
            quit_app
        ])
        .setup(move |app| {
            // No Dock icon. The app lives in the menu bar.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window =
                WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::External(tray_page("/")))
                    .title("pr-peek")
                    .inner_size(380.0, 600.0)
                    .resizable(false)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    // Keeps the live stream and timers running while hidden.
                    .background_throttling(BackgroundThrottlingPolicy::Disabled)
                    .build()?;

            // Hides like a menu when the user clicks elsewhere.
            let handle = app.handle().clone();
            let blurred = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    hide(&blurred);
                    if let Ok(mut at) = handle.state::<HiddenAt>().0.lock() {
                        *at = Some(Instant::now());
                    }
                }
            });

            build_tray(app.handle())?;
            // Another app may own the shortcut. The tray icon still works without it.
            if let Err(err) = app.global_shortcut().register(toggle_shortcut) {
                eprintln!("pr-peek: couldn't register Option+Command+P: {err}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("pr-peek failed to start");
}
