package com.iptvplayer.iptv_player

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Máscara y puerta de enlace reales para buscar el portal en la red (ambas versiones).
        NetworkInfoChannel.register(this, flutterEngine)
        // Cada distribución agrega lo suyo (src/play o src/portal).
        FlavorSetup.configure(this, flutterEngine)
    }
}
