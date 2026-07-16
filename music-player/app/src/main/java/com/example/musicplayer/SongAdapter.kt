package com.example.musicplayer

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.example.musicplayer.databinding.ItemSongBinding
import java.util.concurrent.TimeUnit

class SongAdapter(
    private val onClick: (Int) -> Unit
) : RecyclerView.Adapter<SongAdapter.SongViewHolder>() {

    private var songs: List<Song> = emptyList()
    private var playingId: Long = -1L

    fun submit(list: List<Song>) {
        songs = list
        notifyDataSetChanged()
    }

    /** Highlights the row whose track id matches, regardless of position. */
    fun setPlayingId(id: Long) {
        if (playingId == id) return
        playingId = id
        notifyDataSetChanged()
    }

    inner class SongViewHolder(val binding: ItemSongBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SongViewHolder {
        val binding = ItemSongBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return SongViewHolder(binding)
    }

    override fun onBindViewHolder(holder: SongViewHolder, position: Int) {
        val song = songs[position]
        holder.binding.title.text = song.title
        holder.binding.artist.text = song.artist
        holder.binding.duration.text = formatDuration(song.duration)
        holder.binding.nowPlaying.visibility =
            if (song.id == playingId) View.VISIBLE else View.INVISIBLE
        holder.binding.root.setOnClickListener { onClick(position) }
    }

    override fun getItemCount(): Int = songs.size

    private fun formatDuration(ms: Long): String {
        val minutes = TimeUnit.MILLISECONDS.toMinutes(ms)
        val seconds = TimeUnit.MILLISECONDS.toSeconds(ms) % 60
        return String.format("%d:%02d", minutes, seconds)
    }
}
