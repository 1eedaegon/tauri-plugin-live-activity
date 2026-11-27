# Tauri discovers command and permission callback methods using reflection.
-keep class io.github.eedaegon.liveactivity.LiveActivityPlugin { *; }
# Jackson fills the argument of registerEvents by reflection.
-keep class io.github.eedaegon.liveactivity.EventRegistration { *; }
# liveupdate's Rust side loads its bridge by this binary name over JNI, also in a process that a push started without
# Tauri (liveupdate's own consumer rules).
-keep class io.github.eedaegon.liveupdate.LiveUpdateBridge { public static *; }
# liveupdate's push entry, which an app's messaging service calls, finds liveactivity's native entry (the plugin's
# feature `android-push`) by the class's and the method's names (liveupdate's own consumer rules).
-keep class io.github.eedaegon.liveupdate.LiveUpdatePush { native <methods>; public *; }
# liveupdate's WearOngoing names classes of androidx.wear:wear-ongoing, which a watch app brings and no other has
# (liveupdate's own consumer rules). It stays the one class that names them: kept, its code is not moved into its
# callers.
-dontwarn androidx.wear.ongoing.**
-dontwarn androidx.core.app.NotificationCompat$Builder
-keep class io.github.eedaegon.liveupdate.WearOngoing { *; }
