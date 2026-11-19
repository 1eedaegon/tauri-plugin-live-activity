# Tauri discovers command and permission callback methods using reflection.
-keep class io.github.eedaegon.liveactivity.LiveActivityPlugin { *; }
# Jackson fills the argument of registerEvents by reflection.
-keep class io.github.eedaegon.liveactivity.EventRegistration { *; }
# liveupdate's WearOngoing names classes of androidx.wear:wear-ongoing, which a watch app brings and no other has
# (liveupdate's own consumer rules). It stays the one class that names them: kept, its code is not moved into its
# callers.
-dontwarn androidx.wear.ongoing.**
-dontwarn androidx.core.app.NotificationCompat$Builder
-keep class io.github.eedaegon.liveupdate.WearOngoing { *; }
