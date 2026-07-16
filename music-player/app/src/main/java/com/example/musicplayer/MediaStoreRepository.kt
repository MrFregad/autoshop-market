package com.example.musicplayer

import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.provider.MediaStore

/** Loads music tracks from the device's MediaStore, grouped by folder. */
object MediaStoreRepository {

    /** All music tracks on the device, each tagged with its containing folder. */
    fun loadSongs(context: Context): List<Song> {
        val songs = mutableListOf<Song>()

        val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = mutableListOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.DURATION,
            @Suppress("DEPRECATION") MediaStore.Audio.Media.DATA
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            projection += MediaStore.Audio.Media.RELATIVE_PATH
        }

        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND " +
            "${MediaStore.Audio.Media.DURATION} >= 5000"
        val sortOrder = "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"

        context.contentResolver.query(
            collection, projection.toTypedArray(), selection, null, sortOrder
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            @Suppress("DEPRECATION")
            val dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA)
            val relPathCol = cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val uri = ContentUris.withAppendedId(collection, id)

                val data = if (dataCol >= 0) cursor.getString(dataCol) else null
                val relPath = if (relPathCol >= 0) cursor.getString(relPathCol) else null
                val (folderPath, folderName) = resolveFolder(data, relPath)

                songs += Song(
                    id = id,
                    title = cursor.getString(titleCol) ?: "Unknown title",
                    artist = cursor.getString(artistCol)
                        ?.takeIf { it != "<unknown>" } ?: "Unknown artist",
                    duration = cursor.getLong(durationCol),
                    uri = uri,
                    folderPath = folderPath,
                    folderName = folderName
                )
            }
        }
        return songs
    }

    /** Groups all tracks into folders, sorted alphabetically by folder name. */
    fun loadFolders(context: Context): List<MusicFolder> {
        return loadSongs(context)
            .groupBy { it.folderPath }
            .map { (path, songs) ->
                MusicFolder(
                    name = songs.first().folderName,
                    path = path,
                    songs = songs
                )
            }
            .sortedBy { it.name.lowercase() }
    }

    /** Derives a folder path + display name from a file path or relative path. */
    private fun resolveFolder(data: String?, relPath: String?): Pair<String, String> {
        if (!data.isNullOrBlank() && data.contains('/')) {
            val folderPath = data.substringBeforeLast('/')
            val name = folderPath.substringAfterLast('/').ifBlank { "Music" }
            return folderPath to name
        }
        if (!relPath.isNullOrBlank()) {
            val trimmed = relPath.trimEnd('/')
            val name = trimmed.substringAfterLast('/').ifBlank { trimmed }
            return trimmed to name.ifBlank { "Music" }
        }
        return "unknown" to "Unknown folder"
    }
}
