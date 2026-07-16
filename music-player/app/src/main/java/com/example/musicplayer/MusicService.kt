package com.example.musicplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.session.MediaButtonReceiver

/**
 * Foreground service that owns the [MediaPlayer]. It is the single source of
 * truth for playback so the UI, the notification and the lock-screen controls
 * all stay in sync. The UI binds to it to send commands and observe state.
 */
class MusicService : android.app.Service(), AudioManager.OnAudioFocusChangeListener {

    companion object {
        const val ACTION_TOGGLE = "com.example.musicplayer.TOGGLE"
        const val ACTION_NEXT = "com.example.musicplayer.NEXT"
        const val ACTION_PREV = "com.example.musicplayer.PREV"

        private const val CHANNEL_ID = "music_playback"
        private const val NOTIFICATION_ID = 1
    }

    /** Callback the Activity registers to reflect playback state in the UI. */
    interface Listener {
        fun onStateChanged()
    }

    private val binder = MusicBinder()
    inner class MusicBinder : Binder() {
        val service: MusicService get() = this@MusicService
    }

    private var player: MediaPlayer? = null
    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var audioManager: AudioManager
    private var audioFocusRequest: AudioFocusRequest? = null

    private val handler = Handler(Looper.getMainLooper())
    private var listener: Listener? = null

    var playlist: List<Song> = emptyList()
        private set
    var currentIndex: Int = -1
        private set

    val currentSong: Song?
        get() = playlist.getOrNull(currentIndex)

    val isPlaying: Boolean
        get() = player?.isPlaying == true

    val currentPosition: Int
        get() = try {
            player?.currentPosition ?: 0
        } catch (e: IllegalStateException) {
            0
        }

    val duration: Int
        get() = try {
            player?.duration ?: 0
        } catch (e: IllegalStateException) {
            0
        }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        createNotificationChannel()
        setupMediaSession()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> togglePlayPause()
            ACTION_NEXT -> next()
            ACTION_PREV -> previous()
            else -> MediaButtonReceiver.handleIntent(mediaSession, intent)
        }
        return START_NOT_STICKY
    }

    fun setListener(l: Listener?) {
        listener = l
    }

    // --- Playback controls -------------------------------------------------

    fun setPlaylist(songs: List<Song>) {
        playlist = songs
    }

    fun playAt(index: Int) {
        if (index !in playlist.indices) return
        currentIndex = index
        val song = playlist[index]

        releasePlayer()
        player = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            setDataSource(this@MusicService, song.uri)
            setOnCompletionListener { next() }
            setOnPreparedListener {
                if (requestAudioFocus()) {
                    start()
                    updateAll()
                }
            }
            prepareAsync()
        }
        updateAll()
    }

    fun togglePlayPause() {
        val p = player
        if (p == null) {
            if (currentIndex >= 0) playAt(currentIndex)
            else if (playlist.isNotEmpty()) playAt(0)
            return
        }
        if (p.isPlaying) {
            p.pause()
        } else {
            if (requestAudioFocus()) p.start()
        }
        updateAll()
    }

    fun next() {
        if (playlist.isEmpty()) return
        playAt((currentIndex + 1) % playlist.size)
    }

    fun previous() {
        if (playlist.isEmpty()) return
        // Restart current track if we're more than 3s in, otherwise go back.
        if (currentPosition > 3000) {
            playAt(currentIndex)
        } else {
            playAt(if (currentIndex - 1 < 0) playlist.size - 1 else currentIndex - 1)
        }
    }

    fun seekTo(ms: Int) {
        try {
            player?.seekTo(ms)
        } catch (e: IllegalStateException) {
            // Player not ready yet; ignore.
        }
        updateNotificationAndSession()
    }

    // --- Audio focus -------------------------------------------------------

    private fun requestAudioFocus(): Boolean {
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(this)
                .build()
            audioFocusRequest = request
            audioManager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN
            )
        }
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(this)
        }
    }

    override fun onAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (isPlaying) {
                    player?.pause()
                    updateAll()
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                player?.setVolume(0.3f, 0.3f)
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                player?.setVolume(1f, 1f)
            }
        }
    }

    // --- MediaSession ------------------------------------------------------

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, "MusicService").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = togglePlayPause()
                override fun onPause() = togglePlayPause()
                override fun onSkipToNext() = next()
                override fun onSkipToPrevious() = previous()
                override fun onSeekTo(pos: Long) = seekTo(pos.toInt())
                override fun onStop() {
                    stopPlayback()
                }
            })
            isActive = true
        }
    }

    private fun updateSessionMetadata() {
        val song = currentSong ?: return
        mediaSession.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, song.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, song.artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, song.duration)
                .build()
        )
        val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING
        else PlaybackStateCompat.STATE_PAUSED
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackStateCompat.ACTION_SEEK_TO or
                        PlaybackStateCompat.ACTION_STOP
                )
                .setState(state, currentPosition.toLong(), 1f)
                .build()
        )
    }

    // --- Notification ------------------------------------------------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Music playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Controls for the currently playing track"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val song = currentSong
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIcon = if (isPlaying)
            android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseTitle = if (isPlaying) "Pause" else "Play"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(song?.title ?: "No track")
            .setContentText(song?.artist ?: "")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .addAction(
                android.R.drawable.ic_media_previous, "Previous",
                actionIntent(ACTION_PREV)
            )
            .addAction(playPauseIcon, playPauseTitle, actionIntent(ACTION_TOGGLE))
            .addAction(
                android.R.drawable.ic_media_next, "Next",
                actionIntent(ACTION_NEXT)
            )
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .setOngoing(isPlaying)
            .build()
    }

    private fun actionIntent(action: String): PendingIntent {
        val intent = Intent(this, MusicService::class.java).setAction(action)
        return PendingIntent.getService(
            this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    // --- State propagation -------------------------------------------------

    private fun updateAll() {
        updateSessionMetadata()
        updateNotificationAndSession()
        listener?.onStateChanged()
    }

    private fun updateNotificationAndSession() {
        val notification = buildNotification()
        if (isPlaying) {
            startForeground(NOTIFICATION_ID, notification)
        } else {
            // Keep the notification but let the service be dismissible when paused.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIFICATION_ID, notification)
        }
    }

    private fun stopPlayback() {
        releasePlayer()
        listener?.onStateChanged()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun releasePlayer() {
        abandonAudioFocus()
        player?.apply {
            try {
                if (isPlaying) stop()
            } catch (e: IllegalStateException) {
                // ignore
            }
            reset()
            release()
        }
        player = null
    }

    override fun onDestroy() {
        releasePlayer()
        mediaSession.release()
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
