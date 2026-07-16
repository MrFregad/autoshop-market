package com.example.musicplayer

/** A device folder that contains one or more music tracks. */
data class MusicFolder(
    val name: String,
    val path: String,
    val songs: List<Song>
)
