// The app target compiles this Swift file so that Xcode takes the App Intents metadata of activitykit's
// ActivityKitIntent product, linked to the app: a Live Activity button's tap runs that intent in the app's process.
// Without Swift in the target, Xcode extracts no metadata and a tap does nothing.
import ActivityKitIntent
