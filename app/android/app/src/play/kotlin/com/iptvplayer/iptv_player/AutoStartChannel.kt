package com.iptvplayer.iptv_player

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Versión Google Play: sin apertura al encender el equipo (ni receptor de arranque ni permisos
 * RECEIVE_BOOT_COMPLETED / SYSTEM_ALERT_WINDOW). El canal existe para que MainActivity sea igual
 * en ambas versiones y responde "no disponible".
 */
object AutoStartChannel {
    private const val CHANNEL = "iptv_player/autostart"

    @Suppress("UNUSED_PARAMETER")
    fun register(activity: FlutterActivity, engine: FlutterEngine) {
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "available" -> result.success(false)
                else -> result.error("UNAVAILABLE", "No disponible en esta versión", null)
            }
        }
    }
}
