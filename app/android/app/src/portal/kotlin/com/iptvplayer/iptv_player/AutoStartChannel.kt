package com.iptvplayer.iptv_player

import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Versión "portal": la app se abre sola al encender el TV box (ver [BootReceiver]).
 * La versión "play" tiene una clase con el mismo nombre que responde "no disponible".
 *
 * Métodos de `iptv_player/autostart`:
 *  - `available`: `true` (esta versión lo incluye).
 *  - `isTv`: el equipo es un televisor o TV box (modo de interfaz TV, leanback o television).
 *  - `sdkInt`: nivel de API de Android.
 *  - `canDrawOverlays`: permiso "Mostrar sobre otras apps" (lo exige Android 10+ para abrir la
 *    app desde el arranque).
 *  - `hasOverlaySettings`: el equipo tiene la pantalla de ese permiso.
 *  - `openOverlaySettings`: abre ese permiso; si el equipo no tiene esa pantalla, los datos de la
 *    app; si tampoco, los Ajustes. Devuelve `overlay`, `app`, `settings` o `""` si no abrió nada.
 */
object AutoStartChannel {
    private const val CHANNEL = "iptv_player/autostart"

    fun register(activity: FlutterActivity, engine: FlutterEngine) {
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "available" -> result.success(true)
                "isTv" -> result.success(isTv(activity))
                "sdkInt" -> result.success(Build.VERSION.SDK_INT)
                "canDrawOverlays" -> result.success(canDrawOverlays(activity))
                "hasOverlaySettings" -> result.success(hasOverlaySettings(activity))
                "openOverlaySettings" -> result.success(openOverlaySettings(activity))
                else -> result.notImplemented()
            }
        }
    }

    /** Televisor o TV box: modo de interfaz TV o característica leanback/television. */
    fun isTv(context: Context): Boolean {
        val uiMode = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        val television = pm.hasSystemFeature(PackageManager.FEATURE_TELEVISION)
        return television || pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    fun canDrawOverlays(context: Context): Boolean = try {
        Settings.canDrawOverlays(context)
    } catch (e: Exception) {
        false
    }

    private fun overlayIntent(context: Context) =
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))

    private fun hasOverlaySettings(context: Context): Boolean = try {
        val intent = overlayIntent(context)
        val pm = context.packageManager
        val found = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.resolveActivity(intent, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            val info = pm.resolveActivity(intent, 0)
            info
        }
        found != null
    } catch (e: Exception) {
        false
    }

    private fun openOverlaySettings(activity: FlutterActivity): String {
        val packageUri = Uri.parse("package:${activity.packageName}")
        val candidates = listOf(
            "overlay" to overlayIntent(activity),
            "app" to Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri),
            "settings" to Intent(Settings.ACTION_SETTINGS),
        )
        for ((name, intent) in candidates) {
            try {
                activity.startActivity(intent)
                return name
            } catch (e: ActivityNotFoundException) {
                // Muchos TV box no traen la pantalla del permiso: se prueba la siguiente.
            } catch (e: SecurityException) {
            }
        }
        return ""
    }
}
