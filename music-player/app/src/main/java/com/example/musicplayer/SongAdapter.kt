package com.example.musicplayer

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.example.musicplayer.databinding.ItemSongBinding
import java.util.concurrent.TimeUnit

class SongAdapter(
    private val onClick: (Int) -> Unit
) : RecyclerView.Adapter<SongAdapter.SongViewHolder>() {

    private var songs: List<Song> = emptyList()
    private var playingIndex: Int = -1

    fun submit(list: List<Song>) {
        songs = list
        notifyDataSetChanged()
    }

    fun setPlayingIndex(index: Int) {
        val old = playingIndex
        playingIndex = index
        if (old in songs.indices) notifyItemChanged(old)
        if (index in songs.indices) notifyItemChanged(index)
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
            if (position == playingIndex) android.view.View.VISIBLE
            else android.view.View.INVISIBLE
        holder.binding.root.setOnClickListener { onClick(position) }
    }

    override fun getItemCount(): Int = songs.size

    private fun formatDuration(ms: Long): String {
        val minutes = TimeUnit.MILLISECONDS.toMinutes(ms)
        val seconds = TimeUnit.MILLISECONDS.toSeconds(ms) % 60
        return String.format("%d:%02d", minutes, seconds)
    }
}
