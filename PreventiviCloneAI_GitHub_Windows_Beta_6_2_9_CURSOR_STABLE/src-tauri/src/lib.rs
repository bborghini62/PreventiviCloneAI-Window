use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn save_file_with_dialog(
  app: tauri::AppHandle,
  suggested_name: String,
  bytes: Vec<u8>,
) -> Result<bool, String> {
  let selected = app
    .dialog()
    .file()
    .set_file_name(&suggested_name)
    .blocking_save_file();

  let Some(file_path) = selected else {
    return Ok(false);
  };

  let path = file_path
    .into_path()
    .map_err(|error| format!("Percorso di salvataggio non valido: {error}"))?;

  std::fs::write(&path, bytes)
    .map_err(|error| format!("Impossibile salvare {}: {error}", path.display()))?;

  Ok(true)
}

#[tauri::command]
fn print_current_window(
  window: tauri::WebviewWindow,
  orientation: String,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo};

    // WKWebView usa le impostazioni di stampa condivise di AppKit. Impostiamo
    // esplicitamente l'orientamento scelto nell'app prima di aprire il pannello.
    let print_info = NSPrintInfo::sharedPrintInfo();
    let selected_orientation = if orientation.eq_ignore_ascii_case("portrait") {
      NSPaperOrientation::Portrait
    } else {
      NSPaperOrientation::Landscape
    };
    print_info.setOrientation(selected_orientation);
    NSPrintInfo::setSharedPrintInfo(&print_info);

    return window
      .print()
      .map_err(|error| format!("Stampa macOS non disponibile: {error}"));
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = orientation;
    window
      .eval("window.focus(); window.print();")
      .map_err(|error| format!("Stampa non disponibile: {error}"))?;
    Ok(())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![
      save_file_with_dialog,
      print_current_window
    ])
    .run(tauri::generate_context!())
    .expect("errore durante l'avvio di Preventivi Clone AI");
}
