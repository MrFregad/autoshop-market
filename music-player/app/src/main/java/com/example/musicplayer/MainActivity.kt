package com.example.musicplayer

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.View
import android.widget.SeekBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.musicplayer.databinding.ActivityMainBinding
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity(), MusicService.Listener {

    private lateinit var binding: ActivityMainBinding
    private lateinit var folderAdapter: FolderAdapter
    private lateinit var songAdapter: SongAdapter

    private var service: MusicService? = null
    private var bound = false

    private val handler = Handler(Looper.getMainLooper())
    private var userIsSeeking = false

    private var folders: List<MusicFolder> = emptyList()
    private var openFolder: MusicFolder? = null

    private val requestPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results[audioPermission()] == true) {
            loadFolders()
        } else {
            showMessage(getString(R.string.permission_needed))
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val musicBinder = binder as MusicService.MusicBinder
            service = musicBinder.service
            service?.setListener(this@MainActivity)
            bound = true
            onStateChanged()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            service = null
            bound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        folderAdapter = FolderAdapter { folder -> showFolder(folder) }
        songAdapter = SongAdapter { index ->
            val songs = openFolder?.songs ?: return@SongAdapter
            service?.setPlaylist(songs)
            service?.playAt(index)
        }
        binding.recyclerView.layoutManager = LinearLayoutManager(this)
        binding.recyclerView.adapter = folderAdapter

        binding.backButton.setOnClickListener { showFolders() }
        binding.playPauseButton.setOnClickListener { service?.togglePlayPause() }
        binding.nextButton.setOnClickListener { service?.next() }
        binding.prevButton.setOnClickListener { service?.previous() }
        binding.shuffleButton.setOnClickListener {
            service?.toggleShuffle()
        }

        binding.seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) binding.currentTime.text = formatTime(progress.toLong())
            }

            override fun onStartTrackingTouch(sb: SeekBar?) {
                userIsSeeking = true
            }

            override fun onStopTrackingTouch(sb: SeekBar?) {
                userIsSeeking = false
                service?.seekTo(sb?.progress ?: 0)
            }
        })

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (openFolder != null) {
                    showFolders()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        ensurePermissionAndLoad()
    }

    override fun onStart() {
        super.onStart()
        Intent(this, MusicService::class.java).also { intent ->
            startService(intent)
            bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }
    }

    override fun onStop() {
        super.onStop()
        service?.setListener(null)
        if (bound) {
            unbindService(connection)
            bound = false
        }
    }

    override fun onResume() {
        super.onResume()
        startProgressUpdates()
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacksAndMessages(null)
    }

    // --- Navigation --------------------------------------------------------

    private fun showFolders() {
        openFolder = null
        binding.recyclerView.adapter = folderAdapter
        binding.headerTitle.text = getString(R.string.folders)
        binding.backButton.visibility = View.GONE
        binding.emptyView.visibility =
            if (folders.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun showFolder(folder: MusicFolder) {
        openFolder = folder
        songAdapter.submit(folder.songs)
        binding.recyclerView.adapter = songAdapter
        binding.recyclerView.scrollToPosition(0)
        binding.headerTitle.text = folder.name
        binding.backButton.visibility = View.VISIBLE
        binding.emptyView.visibility = View.GONE
        service?.currentSong?.let { songAdapter.setPlayingId(it.id) }
    }

    // --- Permissions -------------------------------------------------------

    private fun audioPermission(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            Manifest.permission.READ_MEDIA_AUDIO
        else
            Manifest.permission.READ_EXTERNAL_STORAGE

    private fun ensurePermissionAndLoad() {
        val perms = mutableListOf(audioPermission())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms += Manifest.permission.POST_NOTIFICATIONS
        }
        val needed = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) loadFolders()
        else requestPermission.launch(needed.toTypedArray())
    }

    private fun loadFolders() {
        folders = MediaStoreRepository.loadFolders(this)
        folderAdapter.submit(folders)
        showFolders()
        if (folders.isEmpty()) showMessage(getString(R.string.no_songs))
    }

    private fun showMessage(text: String) {
        binding.emptyView.text = text
        binding.emptyView.visibility = View.VISIBLE
    }

    // --- Playback state ----------------------------------------------------

    override fun onStateChanged() {
        runOnUiThread {
            val svc = service ?: return@runOnUiThread
            val song = svc.currentSong
            if (song != null) {
                binding.nowPlayingBar.visibility = View.VISIBLE
                binding.nowPlayingTitle.text = song.title
                binding.nowPlayingArtist.text = song.artist
                songAdapter.setPlayingId(song.id)
            }
            binding.playPauseButton.setImageResource(
                if (svc.isPlaying) android.R.drawable.ic_media_pause
                else android.R.drawable.ic_media_play
            )
            val shuffleColor = if (svc.shuffleEnabled) R.color.accent else R.color.text_secondary
            binding.shuffleButton.setColorFilter(ContextCompat.getColor(this, shuffleColor))
        }
    }

    private fun startProgressUpdates() {
        handler.post(object : Runnable {
            override fun run() {
                val svc = service
                if (svc != null && svc.currentSong != null) {
                    val duration = svc.duration
                    val position = svc.currentPosition
                    if (duration > 0) {
                        binding.seekBar.max = duration
                        if (!userIsSeeking) {
                            binding.seekBar.progress = position
                            binding.currentTime.text = formatTime(position.toLong())
                        }
                        binding.totalTime.text = formatTime(duration.toLong())
                    }
                }
                handler.postDelayed(this, 500)
            }
        })
    }

    private fun formatTime(ms: Long): String {
        val minutes = TimeUnit.MILLISECONDS.toMinutes(ms)
        val seconds = TimeUnit.MILLISECONDS.toSeconds(ms) % 60
        return String.format("%d:%02d", minutes, seconds)
    }
}
