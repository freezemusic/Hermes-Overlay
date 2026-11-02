//! The only calls left on the old gateway (`gateway_base_url`, default port
//! 8642). The Hermes Dashboard (9119) has no equivalent for these yet, so
//! they stay here, outside the chat client, behind one clearly named module.
//!
//! Left here (R-CL-01, R-AR-04):
//! - Profile hints from the gateway's /health, used only when the dashboard
//!   profile list is unreachable during setup discovery.
//!
//! Card moves left this module on 2026-11-02 (todo 37): they go to the
//! dashboard Kanban plugin (`PATCH /api/plugins/kanban/tasks/{id}`) through
//! `HermesClient::patch_kanban_task` (R-KB-07).

pub use crate::hermes::profiles_from_gateway_health;
