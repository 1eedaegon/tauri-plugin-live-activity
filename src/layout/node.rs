use super::{non_null, none};
use serde::{Deserialize, Deserializer, Serialize, de::Error as _};

/// One node of a layout tree: an element and the members every node may carry.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Node {
    #[serde(flatten)]
    pub element: Element,
    /// A token of the request's style table.
    #[serde(skip_serializing_if = "none")]
    pub style: Option<String>,
    /// Key of a value; the node is rendered only while it is truthy.
    #[serde(skip_serializing_if = "none")]
    pub r#if: Option<String>,
    /// Key of a value; the node is rendered only while it is not truthy.
    #[serde(skip_serializing_if = "none")]
    pub unless: Option<String>,
}

impl From<Element> for Node {
    fn from(element: Element) -> Self {
        Self {
            element,
            style: None,
            r#if: None,
            unless: None,
        }
    }
}

impl<'de> Deserialize<'de> for Node {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Serde cannot deny unknown members next to `flatten`, so the common members are
        // taken out first and the element reads the rest strictly.
        let mut members = serde_json::Map::deserialize(deserializer)?;
        let mut key = |name| match members.remove(name) {
            None => Ok(None),
            Some(serde_json::Value::String(key)) => Ok(Some(key)),
            Some(_) => Err(D::Error::custom("expected a string")),
        };
        let (style, r#if, unless) = (key("style")?, key("if")?, key("unless")?);
        let element =
            Element::deserialize(serde_json::Value::Object(members)).map_err(D::Error::custom)?;
        Ok(Self {
            element,
            style,
            r#if,
            unless,
        })
    }
}

/// What a node shows. The wire member `type` selects the variant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Element {
    Vstack {
        children: Vec<Node>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        spacing: Option<f64>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        alignment: Option<HorizontalAlignment>,
    },
    Hstack {
        children: Vec<Node>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        spacing: Option<f64>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        alignment: Option<VerticalAlignment>,
    },
    Zstack {
        children: Vec<Node>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        alignment: Option<Alignment>,
    },
    #[serde(rename_all = "camelCase")]
    Spacer {
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        min_length: Option<f64>,
    },
    Divider {},
    /// Exactly one of the literal `value` and `bind`, the key of a value.
    Text {
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        value: Option<String>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        bind: Option<String>,
    },
    /// An SF Symbol; `variable_bind` names a number value.
    #[serde(rename_all = "camelCase")]
    Symbol {
        name: String,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        rendering: Option<SymbolRendering>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        variable_bind: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Image {
        source: ImageSource,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        resizable: Option<bool>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        content_mode: Option<ContentMode>,
    },
    /// SVG path data in a `[width, height]` box; stroked when `stroke` is present.
    Path {
        d: String,
        r#box: [f64; 2],
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        stroke: Option<f64>,
    },
    Progress {
        bind: String,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        kind: Option<IndicatorKind>,
    },
    Gauge {
        bind: String,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        min: Option<f64>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        max: Option<f64>,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        kind: Option<IndicatorKind>,
    },
    /// `start` and `end` name number values in epoch milliseconds.
    #[serde(rename_all = "camelCase")]
    TimerText {
        start: String,
        end: String,
        #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
        counts_down: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    Button {
        action_id: String,
        child: Box<Node>,
    },
}

/// An image in the widget extension's asset catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageSource {
    pub asset: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HorizontalAlignment {
    Leading,
    Center,
    Trailing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VerticalAlignment {
    Top,
    Center,
    Bottom,
    FirstTextBaseline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Alignment {
    Center,
    Leading,
    Trailing,
    Top,
    Bottom,
    TopLeading,
    TopTrailing,
    BottomLeading,
    BottomTrailing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SymbolRendering {
    Monochrome,
    Hierarchical,
    Palette,
    Multicolor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentMode {
    Fit,
    Fill,
}

/// Shape of a progress view or a gauge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndicatorKind {
    Linear,
    Circular,
}
