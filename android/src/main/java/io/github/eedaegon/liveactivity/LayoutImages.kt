package io.github.eedaegon.liveactivity

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

/**
 * The PNGs that the app writes with `writeImage`. Rust checks and writes them; Android has no App
 * Group, so they live in the app's private files. The first image of a layout drawn from a file
 * becomes the notification's large icon.
 */
internal object LayoutImages {
    /** The system shows a large icon at a few dozen dp; a bigger bitmap only costs memory. */
    private const val ICON_SIDE = 256

    private const val FOLDER = "tauri-live-activity/images"

    /** The folder, created when missing, for `imageDirectory`. */
    fun directory(context: Context): File {
        val folder = File(context.filesDir, FOLDER)
        if (!folder.isDirectory && !folder.mkdirs()) throw ActivityFailure("NATIVE_ERROR", "The image folder could not be created.")
        return folder
    }

    /**
     * The image, scaled down by a power of two to at most [ICON_SIDE], or null when it is missing or unreadable:
     * an optional picture never keeps the notification from being posted.
     */
    fun icon(context: Context, name: String): Bitmap? {
        val file = File(File(context.filesDir, FOLDER), name)
        if (!file.isFile) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight) })
    }

    /** The power of two that brings the longer side to at most [ICON_SIDE]. */
    fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        while (maxOf(width, height) / sample > ICON_SIDE) sample *= 2
        return sample
    }
}
