use super::{Alignment, HorizontalAlignment, non_null, none};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};

/// Modifiers a node takes through its `style` token. At least one member; `font` and `size`
/// exclude each other.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Style {
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub font: Option<Font>,
    /// Font size in points.
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub size: Option<f64>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub weight: Option<FontWeight>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub design: Option<FontDesign>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub monospaced_digit: Option<bool>,
    /// Foreground color.
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub color: Option<Color>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub line_limit: Option<u8>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub minimum_scale_factor: Option<f64>,
    /// Alignment of text that spans several lines.
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub alignment: Option<HorizontalAlignment>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub padding: Option<Padding>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub frame: Option<Frame>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub background: Option<Color>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub corner_radius: Option<f64>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub opacity: Option<f64>,
    /// Tint of buttons, progress views and gauges.
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub tint: Option<Color>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub button_style: Option<ButtonStyle>,
}

/// Sizes in points. At least one member.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub width: Option<f64>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub height: Option<f64>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub min_width: Option<f64>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub min_height: Option<f64>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub max_width: Option<Dimension>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub max_height: Option<Dimension>,
    #[serde(default, deserialize_with = "non_null", skip_serializing_if = "none")]
    pub alignment: Option<Alignment>,
}

/// A length in points, or `"infinity"` on the wire.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Dimension {
    Points(f64),
    Infinity,
}

impl Serialize for Dimension {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Points(points) => serializer.serialize_f64(*points),
            Self::Infinity => serializer.serialize_str("infinity"),
        }
    }
}

impl<'de> Deserialize<'de> for Dimension {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            Points(f64),
            Word(String),
        }
        match Wire::deserialize(deserializer)? {
            Wire::Points(points) => Ok(Self::Points(points)),
            Wire::Word(word) if word == "infinity" => Ok(Self::Infinity),
            Wire::Word(_) => Err(D::Error::custom("expected a number or \"infinity\"")),
        }
    }
}

/// One number for every edge, or `[top, leading, bottom, trailing]`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Padding {
    All(f64),
    Edges([f64; 4]),
}

/// A semantic name, one hex color for both appearances, or a light and dark pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum Color {
    Named(ColorName),
    /// `#RRGGBB` or `#RRGGBBAA`.
    Hex(String),
    /// Hex colors for the light and the dark appearance.
    Adaptive {
        light: String,
        dark: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorName {
    Primary,
    Secondary,
    Accent,
    Red,
    Orange,
    Yellow,
    Green,
    Mint,
    Teal,
    Cyan,
    Blue,
    Indigo,
    Purple,
    Pink,
    Brown,
    White,
    Black,
    Gray,
    Clear,
}

/// A system text style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Font {
    LargeTitle,
    Title,
    Title2,
    Title3,
    Headline,
    Subheadline,
    Body,
    Callout,
    Footnote,
    Caption,
    Caption2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontWeight {
    UltraLight,
    Thin,
    Light,
    Regular,
    Medium,
    Semibold,
    Bold,
    Heavy,
    Black,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontDesign {
    Default,
    Rounded,
    Serif,
    Monospaced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ButtonStyle {
    Automatic,
    Bordered,
    BorderedProminent,
    Plain,
}
