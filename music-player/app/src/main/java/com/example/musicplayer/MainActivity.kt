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
import android.widget.SeekBar
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.musicplayer.databinding.ActivityMainBinding
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity(), MusicService.Listener {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: SongAdapter

    private var service: MusicService? = null
    private var bound = false

    private val handler = Handler(Looper.getMainLooper())
    private var userIsSeeking = false

    private val requestPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results[audioPermission()] == true) {
            loadSongs()
        } else {
            binding.emptyView.text = getString(R.string.permission_needed)
            binding.emptyView.visibility = android.view.View.VISIBLE
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val musicBinder = binder as MusicService.MusicBinder
            service = musicBinder.service
            service?.setListener(this@MainActivity)
            bound = true
            // Push already-loaded songs into the service.
            if (currentSongs.isNotEmpty()) service?.setPlaylist(currentSongs)
            onStateChanged()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            service = null
            bound = false
        }
    }

    private var currentSongs: List<Song> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = SongAdapter { index ->
            currentSongs.let { service?.setPlaylist(it) }
            service?.playAt(index)
        }
        binding.recyclerView.layoutManager = LinearLayoutManager(this)
        binding.recyclerView.adapter = adapter

        binding.playPauseButton.setOnClickListener { service?.togglePlayPause() }
        binding.nextButton.setOnClickListener { service?.next() }
        binding.prevButton.setOnClickListener { service?.previous() }

        binding.seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) {
                    binding.currentTime.text = formatTime(progress.toLong())
                }
            }

            override fun onStartTrackingTouch(sb: SeekBar?) {
                userIsSeeking = true
            }

            override fun onStopTrackingTouch(sb: SeekBar?) {
                userIsSeeking = false
                service?.seekTo(sb?.progress ?: 0)
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
        if (needed.isEmpty()) {
            loadSongs()
        } else {
            requestPermission.launch(needed.toTypedArray())
        }
    }

    private fun loadSongs() {
        val songs = MediaStoreRepository.loadSongs(this)
        currentSongs = songs
        adapter.submit(songs)
        service?.setPlaylist(songs)

        if (songs.isEmpty()) {
            binding.emptyView.text = getString(R.string.no_songs)
            binding.emptyView.visibility = android.view.View.VISIBLE
        } else {
            binding.emptyView.visibility = android.view.View.GONE
        }
    }

    // --- Playback state ----------------------------------------------------

    override fun onStateChanged() {
        runOnUiThread {
            val svc = service ?: return@runOnUiThread
            val song = svc.currentSong
            if (song != null) {
                binding.nowPlayingBar.visibility = android.view.View.VISIBLE
                binding.nowPlayingTitle.text = song.title
                binding.nowPlayingArtist.text = song.artist
                adapter.setPlayingIndex(svc.currentIndex)
            }
            binding.playPauseButton.setImageResource(
                if (svc.isPlaying) android.R.drawable.ic_media_pause
                else android.R.drawable.ic_media_play
            )
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
