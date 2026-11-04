package io.github.eedaegon.liveactivity

/** Fail-closed until dismissal is durably recorded; all accesses hold ACTIVITY_LOCK. */
internal object DismissalMemory {
    private var ids: Set<String> = emptySet()
    fun remember(id: String) { ids = ids + id }
    fun contains(id: String): Boolean = id in ids
    fun forget(id: String) { ids = ids - id }
}
