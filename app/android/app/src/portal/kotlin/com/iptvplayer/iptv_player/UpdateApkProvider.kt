package com.iptvplayer.iptv_player

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Entrega al instalador del sistema, en solo lectura, los APK de `cache/updates`
 * (content://<paquete>.updates/<archivo>.apk). No expone ninguna otra carpeta.
 */
class UpdateApkProvider : ContentProvider() {
    companion object {
        const val APK_MIME = "application/vnd.android.package-archive"

        fun updatesDir(context: Context): File = File(context.cacheDir, "updates").apply { mkdirs() }

        fun uriFor(context: Context, name: String): Uri = Uri.Builder()
            .scheme("content")
            .authority("${context.packageName}.updates")
            .appendPath(name)
            .build()
    }

    override fun onCreate(): Boolean = true

    private fun fileFor(uri: Uri): File? {
        val ctx = context ?: return null
        val segments = uri.pathSegments
        if (segments.size != 1) return null
        val name = segments[0]
        if (!name.endsWith(".apk") || name.startsWith(".")) return null
        val dir = updatesDir(ctx).canonicalFile
        val file = File(dir, name).canonicalFile
        return if (file.parentFile == dir && file.isFile) file else null
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("Solo lectura")
        val file = fileFor(uri) ?: throw FileNotFoundException(uri.toString())
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String = APK_MIME

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        val file = fileFor(uri) ?: return null
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(columns).apply {
            addRow(columns.map {
                when (it) {
                    OpenableColumns.DISPLAY_NAME -> file.name
                    OpenableColumns.SIZE -> file.length()
                    else -> null
                }
            })
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
        throw UnsupportedOperationException()

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException()
}
