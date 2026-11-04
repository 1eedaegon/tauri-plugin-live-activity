package io.github.eedaegon.liveactivity

import org.junit.Assert.*
import org.junit.Test

class LifecycleTest {
    private val snapshot = Snapshot(0, "Delivery", "Preparing", 0.0, null, null)
    private val request = StartRequest("delivery:1", 1, "progress", "notification", snapshot)

    private class MemoryStore : RecordStore {
        var records: List<ActivityRecord> = emptyList()
        var failAtWrite: Int? = null
        var writes = 0
        override fun read() = records
        override fun write(records: List<ActivityRecord>) {
            writes += 1
            if (writes == failAtWrite) throw ActivityFailure("NATIVE_ERROR", "Disk failure")
            this.records = records.toList()
        }
    }

    private class FakePort : NotificationPort {
        var allowed = true
        var promotion = false
        var delayCancellation = false
        var failNextPost = false
        var delayObservation = false
        var posts = 0
        var cancels = 0
        var visible: Map<String, ActivityRecord> = emptyMap()
        override fun notificationsAllowed() = allowed
        override fun promotionAllowed() = promotion
        override fun observed() = visible
        override fun post(record: ActivityRecord) {
            posts += 1
            if (failNextPost) { failNextPost = false; throw ActivityFailure("NATIVE_ERROR", "Posting failed") }
            if (!delayObservation) visible = visible + (record.id to record.copy(state = "active", awaitingObservation = false, promotionState = if (promotion) "promoted" else "notApplicable"))
        }
        override fun cancel(id: String) { cancels += 1; if (!delayCancellation) visible = visible - id }
    }

    private fun error(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (error: ActivityFailure) { assertEquals(code, error.code) }
    }

    @Test fun duplicateStartAndEndAreIdempotentAndNeverReuseHandles() {
        val port = FakePort(); val engine = ActivityEngine(MemoryStore(), port)
        val first = engine.start(request)
        assertEquals(first.id, engine.start(request).id)
        assertEquals(1, port.posts)
        assertEquals("ended", engine.end(first.id, "immediate").state)
        engine.end(first.id, "immediate")
        assertEquals(1, port.cancels)
        val second = engine.start(request)
        assertNotEquals(first.id, second.id)
        error("NOT_FOUND") { engine.update(first.id, snapshot.copy(revision = 1)) }
    }

    @Test fun rejectsStaleConflictingAndTemplateChangingUpdates() {
        val port = FakePort(); val engine = ActivityEngine(MemoryStore(), port)
        val first = engine.start(request)
        error("CONFLICT") { engine.start(request.copy(snapshot = snapshot.copy(title = "Other"))) }
        engine.update(first.id, snapshot.copy(revision = 2, progress = 0.5))
        error("STALE_REVISION") { engine.update(first.id, snapshot.copy(revision = 1)) }
        error("CONFLICT") { engine.update(first.id, snapshot.copy(revision = 2, progress = 0.7)) }
        error("INVALID_INPUT") { engine.update(first.id, snapshot.copy(revision = 3, progress = null, timer = Timer(1, 2))) }
        engine.update(first.id, snapshot.copy(revision = 2, progress = 0.5))
        assertEquals(2, port.posts)
    }

    @Test fun permissionsAndExplicitFallbackAreRespected() {
        val port = FakePort(); val engine = ActivityEngine(MemoryStore(), port)
        port.allowed = false
        error("PERMISSION_DENIED") { engine.start(request) }
        port.allowed = true
        error("UNSUPPORTED_FEATURE") { engine.start(request.copy(fallback = "none")) }
        port.promotion = true
        assertEquals("promoted", engine.start(request.copy(fallback = "none")).promotionState)
    }

    @Test fun processRestartReconcilesNativeStateAndUserDismissal() {
        val store = MemoryStore(); val port = FakePort()
        val first = ActivityEngine(store, port).start(request)
        val restarted = ActivityEngine(store, port)
        assertEquals(first.id, restarted.list().single().id)
        port.visible = emptyMap()
        assertEquals("dismissed", restarted.list().single().state)
        error("NOT_FOUND") { restarted.update(first.id, snapshot.copy(revision = 1)) }
        assertEquals(1, port.posts)
    }

    @Test fun nativeExtrasAloneCannotAcquireOwnershipOfAnUnknownGeneration() {
        val store = MemoryStore(); val port = FakePort()
        val first = ActivityEngine(store, port).start(request)
        store.records = emptyList()
        val restarted = ActivityEngine(store, port)
        assertTrue(restarted.list().isEmpty())
        error("NOT_FOUND") { restarted.update(first.id, snapshot.copy(revision = 1)) }
    }

    @Test fun unsupportedDelayedEndDoesNotCancelAndUnknownHandleFails() {
        val port = FakePort(); val engine = ActivityEngine(MemoryStore(), port)
        val first = engine.start(request)
        error("UNSUPPORTED_FEATURE") { engine.end(first.id, "after") }
        error("NOT_FOUND") { engine.end("unknown", "immediate") }
        assertEquals(0, port.cancels)
    }

    @Test fun delayedNativeObservationDoesNotDismissOrLoseAcceptedUpdates() {
        val store = MemoryStore(); val port = FakePort(); val engine = ActivityEngine(store, port)
        port.delayObservation = true
        port.promotion = true
        val pending = engine.start(request)
        assertEquals("unknown", pending.state)
        assertEquals("unknown", pending.promotionState)
        assertEquals("unknown", engine.list().single().state)
        assertEquals(0, engine.update(pending.id, snapshot).snapshot.revision)
        port.visible = mapOf(pending.id to pending.copy(state = "active", awaitingObservation = false))
        assertEquals("active", engine.list().single().state)
        val accepted = engine.update(pending.id, snapshot.copy(revision = 1, progress = 0.5))
        assertEquals(1, accepted.snapshot.revision)
        assertEquals("unknown", accepted.state)
        assertEquals(0, port.cancels)
        port.visible = mapOf(pending.id to accepted.copy(state = "active", awaitingObservation = false))
        assertEquals(1, engine.list().single().snapshot.revision)
        assertEquals("active", engine.list().single().state)
    }

    @Test fun failedPostsAreRetriedInsteadOfReportedAsIdempotentSuccess() {
        val store = MemoryStore(); val port = FakePort(); val engine = ActivityEngine(store, port)
        port.failNextPost = true
        error("NATIVE_ERROR") { engine.start(request) }
        val pendingId = store.records.single().id
        val recovered = engine.start(request)
        assertEquals(pendingId, recovered.id)
        assertEquals("active", recovered.state)
        assertEquals(2, port.posts)
        port.failNextPost = true
        val updated = snapshot.copy(revision = 1, progress = 0.7)
        error("NATIVE_ERROR") { engine.update(recovered.id, updated) }
        assertEquals("active", engine.update(recovered.id, updated).state)
        assertEquals(4, port.posts)
    }

    @Test fun postFailureRemainsRetryableEvenIfAFollowupMetadataWriteCannotSucceed() {
        val store = MemoryStore(); val port = FakePort()
        store.failAtWrite = 2
        port.failNextPost = true
        error("NATIVE_ERROR") { ActivityEngine(store, port).start(request) }
        store.failAtWrite = null
        val recovered = ActivityEngine(store, port).start(request)
        assertEquals(2, port.posts)
        assertEquals("active", recovered.state)
    }

    @Test fun repeatedPostingFailureStillThrowsAndAnExplicitEndPreventsRetries() {
        val store = MemoryStore(); val port = FakePort(); val engine = ActivityEngine(store, port)
        repeat(2) {
            port.failNextPost = true
            error("NATIVE_ERROR") { engine.start(request) }
        }
        assertEquals(2, port.posts)
        val failed = store.records.single()
        assertEquals("unknown", failed.state)
        engine.end(failed.id, "immediate")
        error("NOT_FOUND") { engine.update(failed.id, snapshot.copy(revision = 1)) }
        assertNotEquals(failed.id, engine.start(request).id)
    }

    @Test fun inProcessDismissalPreventsRepostingWhenPersistenceWasInterrupted() {
        val store = MemoryStore(); val port = FakePort(); val engine = ActivityEngine(store, port)
        port.delayObservation = true
        val pending = engine.start(request)
        DismissalMemory.remember(pending.id)
        error("NOT_FOUND") { engine.update(pending.id, snapshot.copy(revision = 1)) }
        assertEquals("dismissed", engine.list().single().state)
        assertEquals(1, port.posts)
    }

    @Test fun evictedEndedHandlesCannotBeReimportedFromDelayedNativeCancellation() {
        val store = MemoryStore(); val port = FakePort(); val engine = ActivityEngine(store, port)
        port.delayCancellation = true
        val first = engine.start(request)
        engine.end(first.id, "immediate")
        repeat(128) {
            val next = engine.start(request.copy(activityKey = "completed:$it"))
            engine.end(next.id, "immediate")
        }
        assertFalse(engine.list().any { it.id == first.id })
        error("NOT_FOUND") { engine.update(first.id, snapshot.copy(revision = 1)) }
        assertTrue(engine.list().all { it.terminal })
    }

    @Test fun limitsActiveRecordsAndRetainsOnlyBoundedTombstones() {
        val store = MemoryStore(); val port = FakePort(); val engine = ActivityEngine(store, port)
        repeat(32) { engine.start(request.copy(activityKey = "activity:$it")) }
        error("SYSTEM_LIMIT") { engine.start(request.copy(activityKey = "overflow")) }
        engine.list().forEach { engine.end(it.id, "immediate") }
        repeat(140) {
            val record = engine.start(request.copy(activityKey = "completed:$it"))
            engine.end(record.id, "immediate")
        }
        assertEquals(128, store.records.size)
    }
}
