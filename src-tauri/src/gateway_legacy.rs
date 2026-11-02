//! The only calls left on the old gateway (`gateway_base_url`, default port
//! 8642). The Hermes Dashboard (9119) has no equivalent for these yet, so
//! they stay here, outside the chat client, behind one clearly named module.
//!
//! Left here (R-CL-01):
//! - `patch_kanban_task`: card moves. The dashboard Kanban plugin has its own
//!   routes, but the overlay's existing move path still uses the gateway
//!   overlay route. Not used by chat.
//! - Profile hints from the gateway's /health, used only when the dashboard
//!   profile list is unreachable during setup discovery.

pub use crate::hermes::patch_kanban_task;
