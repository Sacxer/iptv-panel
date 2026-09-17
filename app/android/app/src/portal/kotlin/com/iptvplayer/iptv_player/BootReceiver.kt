package com.iptvplayer.iptv_player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Versión "portal": abre la app al encender el equipo, solo en televisores y TV box.
 *
 * Android 10+ solo deja abrir una pantalla desde el arranque si la app tiene el permiso
 * "Mostrar sobre otras apps"; sin él no se hace nada. En Android 9 o anterior no hace falta.
 * La opción no se puede apagar desde la app (decisión del operador).
 */
class BootReceiver : BroadcastReceiver() {
    companion object {
        private val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
        )
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action !in ACTIONS) return
        if (!AutoStartChannel.isTv(context)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !AutoStartChannel.canDrawOverlays(context)) {
            return
        }
        val launch = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(launch)
        } catch (e: Exception) {
            // El sistema no dejó abrirla (restricciones del fabricante): no se insiste.
        }
    }
}
