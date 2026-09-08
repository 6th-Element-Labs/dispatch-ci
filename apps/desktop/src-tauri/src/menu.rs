//! Native macOS menu: the standard app, Edit, and Window menus plus two
//! service controls. Edit items are required for text editing in WebKit.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub const RESTART_SERVICES: &str = "restart-services";
pub const RETURN_TO_MAIL: &str = "return-to-mail";
pub const WEB_BACK: &str = "web-back";
pub const WEB_FORWARD: &str = "web-forward";
pub const WEB_RELOAD: &str = "web-reload";
pub const OPEN_LOGS: &str = "open-logs";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let restart = MenuItemBuilder::with_id(RESTART_SERVICES, "Restart Services").build(app)?;
    let logs = MenuItemBuilder::with_id(OPEN_LOGS, "Open Service Logs").build(app)?;
    let application = SubmenuBuilder::new(app, "Dispatch")
        .about(None)
        .separator()
        .item(&restart)
        .item(&logs)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let back = MenuItemBuilder::with_id(WEB_BACK, "Back").accelerator("CmdOrCtrl+[").build(app)?;
    let forward = MenuItemBuilder::with_id(WEB_FORWARD, "Forward").accelerator("CmdOrCtrl+]").build(app)?;
    let reload = MenuItemBuilder::with_id(WEB_RELOAD, "Reload Web Page").accelerator("CmdOrCtrl+R").build(app)?;
    let mail = MenuItemBuilder::with_id(RETURN_TO_MAIL, "Return to Mail").accelerator("CmdOrCtrl+Shift+M").build(app)?;
    let navigation = SubmenuBuilder::new(app, "Navigate").item(&back).item(&forward).item(&reload).separator().item(&mail).build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .fullscreen()
        .separator()
        .close_window()
        .build()?;
    MenuBuilder::new(app).items(&[&application, &edit, &navigation, &window]).build()
}
