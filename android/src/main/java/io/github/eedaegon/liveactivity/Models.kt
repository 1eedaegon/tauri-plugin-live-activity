package io.github.eedaegon.liveactivity

internal const val PLUGIN_PREFERENCES = "io.github.eedaegon.liveactivity.v1"
internal class ActivityFailure(val code: String, message: String) : Exception(message)
