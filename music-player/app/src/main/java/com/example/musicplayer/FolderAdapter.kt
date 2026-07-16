package com.example.musicplayer

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.example.musicplayer.databinding.ItemFolderBinding

class FolderAdapter(
    private val onClick: (MusicFolder) -> Unit
) : RecyclerView.Adapter<FolderAdapter.FolderViewHolder>() {

    private var folders: List<MusicFolder> = emptyList()

    fun submit(list: List<MusicFolder>) {
        folders = list
        notifyDataSetChanged()
    }

    inner class FolderViewHolder(val binding: ItemFolderBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): FolderViewHolder {
        val binding = ItemFolderBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return FolderViewHolder(binding)
    }

    override fun onBindViewHolder(holder: FolderViewHolder, position: Int) {
        val folder = folders[position]
        val ctx = holder.binding.root.context
        holder.binding.folderName.text = folder.name
        holder.binding.folderCount.text = ctx.resources.getQuantityString(
            R.plurals.track_count, folder.songs.size, folder.songs.size
        )
        holder.binding.root.setOnClickListener { onClick(folder) }
    }

    override fun getItemCount(): Int = folders.size
}
