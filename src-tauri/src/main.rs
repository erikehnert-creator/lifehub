// LifeHub – Windows-Hülle.
// Die gesamte Fachlogik liegt im Web-Frontend; diese Hülle stellt nur das
// Anwendungsfenster bereit. Dadurch bleibt die Plattformschicht austauschbar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("LifeHub konnte nicht gestartet werden");
}
