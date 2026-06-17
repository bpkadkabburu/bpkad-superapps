fn get_db_url() -> String {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(std::path::PathBuf::from))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let db_path = exe_dir.join("bpkad_superapps.db");
    let path_str = db_path.to_string_lossy().replace("\\", "/");
    format!("sqlite:{}", path_str)
}

#[tauri::command]
fn get_db_path() -> String {
    get_db_url()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_url = get_db_url();

    let migrations = vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&db_url, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_db_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
