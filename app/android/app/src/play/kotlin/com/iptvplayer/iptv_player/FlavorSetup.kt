package com.iptvplayer.iptv_player

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

/**
 * Versión Google Play: Play actualiza la app, así que aquí no hay actualizador propio
 * ni canal de instalación (y el manifiesto no pide REQUEST_INSTALL_PACKAGES).
 */
object FlavorSetup {
    @Suppress("UNUSED_PARAMETER")
    fun configure(activity: FlutterActivity, engine: FlutterEngine) {
        // Nada que registrar.
    }
}
