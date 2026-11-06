//! Request contract v2: a layout tree, a style table and a map of values.

#[cfg(test)]
mod limit_tests;
#[cfg(test)]
mod model_tests;
mod node;
mod path;
#[cfg(test)]
mod rule_tests;
mod style;
mod validation;
mod weight;

pub use node::*;
pub use style::*;
pub(crate) use validation::parse;
pub use weight::weight;

use crate::models::{ActivityState, Backend, Fallback, PromotionState, Visibility};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

/// Reads a member that may be absent but never `null`.
fn non_null<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

fn none<T>(member: &Option<T>) -> bool {
    member.is_none()
}

/// A displayed value: text, a number or a flag.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Text(String),
    Number(f64),
    Bool(bool),
}

/// The values a layout shows. An update replaces the whole map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutSnapshot {
    pub revision: u64,
    pub values: BTreeMap<String, Value>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub stale_at: Option<u64>,
}

/// The four regions of the expanded Dynamic Island.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IslandExpanded {
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub leading: Option<Node>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub trailing: Option<Node>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub center: Option<Node>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub bottom: Option<Node>,
}

/// Dynamic Island presentations. A part left out renders a default.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Island {
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub expanded: Option<IslandExpanded>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub compact_leading: Option<Node>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub compact_trailing: Option<Node>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub minimal: Option<Node>,
}

/// One tree per region. The layout is fixed when the activity starts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    pub lock_screen: Node,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub island: Option<Island>,
    /// Tint behind the lock screen presentation.
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub background: Option<Color>,
    /// Tint of the Dynamic Island keyline.
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub keyline: Option<Color>,
}

/// Lock screen visibility of the Android notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AndroidVisibility {
    Public,
    Private,
    Secret,
}

/// Options that only the Android backend reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AndroidOptions {
    pub visibility: AndroidVisibility,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutStartInput {
    pub activity_key: String,
    pub schema_version: u8,
    pub fallback: Fallback,
    pub layout: Layout,
    /// Styles by token; nodes name them with `style`.
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub styles: Option<BTreeMap<String, Style>>,
    pub snapshot: LayoutSnapshot,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub android: Option<AndroidOptions>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutUpdateInput {
    pub id: String,
    pub snapshot: LayoutSnapshot,
}

/// A layout activity as the native side reports it. It does not repeat the layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutActivityRecord {
    pub id: String,
    pub activity_key: String,
    pub schema_version: u8,
    pub snapshot: LayoutSnapshot,
    pub backend: Backend,
    pub state: ActivityState,
    pub visibility: Visibility,
    pub degraded_features: Vec<String>,
    pub promotion_requested: bool,
    pub promotion_state: PromotionState,
}

/// A tap on a button node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEvent {
    pub action_id: String,
    /// Handle of the activity that showed the button.
    pub activity_id: String,
    /// Absent when the plugin no longer knows that activity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_key: Option<String>,
}
