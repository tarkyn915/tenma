mod local_library;

#[cfg(desktop)]
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Listener, Manager, Runtime,
};

#[cfg(desktop)]
fn restore_main_window<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
  let open = MenuItem::with_id(app, "tray-open", "Open Tenma Player", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open, &quit])?;

  let open_for_language = open.clone();
  let quit_for_language = quit.clone();
  app.listen("tenma-language", move |event| {
    let language = serde_json::from_str::<String>(event.payload()).unwrap_or_default();
    let (open_text, quit_text) = if language == "zh-CN" {
      ("打开 Tenma Player", "退出")
    } else {
      ("Open Tenma Player", "Quit")
    };
    let _ = open_for_language.set_text(open_text);
    let _ = quit_for_language.set_text(quit_text);
  });

  TrayIconBuilder::with_id("tenma-tray")
    .icon(app.default_window_icon().expect("Tenma Player window icon").clone())
    .tooltip("Tenma Player")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "tray-open" => restore_main_window(app),
      "tray-quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        restore_main_window(tray.app_handle());
      }
    })
    .build(app)?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        setup_tray(app)?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      local_library::pick_local_library_folder,
      local_library::scan_local_library,
      local_library::read_local_lyrics,
      local_library::pick_background_image
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
