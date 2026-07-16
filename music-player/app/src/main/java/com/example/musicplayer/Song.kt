package com.example.musicplayer

import android.net.Uri

/** A single audio track discovered on the device. */
data class Song(
    val id: Long,
    val title: String,
    val artist: String,
    val duration: Long,
    val uri: Uri
)
