use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};

const WINDOW: &str = "main";
// A click on the tray icon first blurs the open window, which hides it. A toggle this
// soon after leaves it hidden instead of showing it again.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

// When the window last hid because it lost focus.
#[derive(Default)]
struct HiddenAt(Mutex<Option<Instant>>);

// The hosted web app. Dev builds use the local Vite server. PR_PEEK_URL overrides both.
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

// Shows the window under the tray icon and focuses it.
fn show_window(window: &WebviewWindow) {
    // The tray position is only known after the icon is clicked once.
    if window.move_window(Position::TrayBottomCenter).is_err() {
        let _ = window.move_window(Position::TopRight);
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
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

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open in browser", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit pr-peek", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&refresh, &open, &settings, &separator, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        // macOS tints a template image to match light and dark menu bars.
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "refresh" => {
                if let Some(window) = main_window(app) {
                    let _ = window.eval("location.reload()");
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
                    .build()?;

            // Hides like a menu when the user clicks elsewhere.
            let handle = app.handle().clone();
            let blurred = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    let _ = blurred.hide();
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
