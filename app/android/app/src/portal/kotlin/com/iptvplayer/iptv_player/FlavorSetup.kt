package com.iptvplayer.iptv_player

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Versión "portal" (APK para celulares, tabletas y TV box): canal para el actualizador propio.
 *
 * Métodos de `iptv_player/installer`:
 *  - `updatesDir`: carpeta donde Dart guarda el APK descargado (caché de la app).
 *  - `canInstall`: si el usuario ya permitió "Instalar apps desconocidas" para esta app.
 *  - `openInstallPermissionSettings`: abre ese ajuste (o el más parecido que exista en el equipo).
 *  - `install` {path}: abre el instalador del sistema con el APK (URI content://, ver UpdateApkProvider).
 */
object FlavorSetup {
    private const val CHANNEL = "iptv_player/installer"

    fun configure(activity: FlutterActivity, engine: FlutterEngine) {
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "updatesDir" -> result.success(UpdateApkProvider.updatesDir(activity).absolutePath)
                "canInstall" -> result.success(canInstall(activity))
                "openInstallPermissionSettings" -> result.success(openInstallPermissionSettings(activity))
                "install" -> install(activity, call.argument<String>("path"), result)
                else -> result.notImplemented()
            }
        }
    }

    private fun canInstall(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            // Android 7: ajuste global "Orígenes desconocidos".
            try {
                @Suppress("DEPRECATION")
                Settings.Secure.getInt(context.contentResolver, Settings.Secure.INSTALL_NON_MARKET_APPS, 0) == 1
            } catch (e: Exception) {
                true
            }
        }
    }

    private fun openInstallPermissionSettings(activity: FlutterActivity): Boolean {
        val packageUri = Uri.parse("package:${activity.packageName}")
        val candidates = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                add(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, packageUri))
            }
            add(Intent(Settings.ACTION_SECURITY_SETTINGS))
            add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
        }
        for (intent in candidates) {
            try {
                activity.startActivity(intent)
                return true
            } catch (e: ActivityNotFoundException) {
                // Algunos TV box no traen ese ajuste: se prueba el siguiente.
            } catch (e: SecurityException) {
            }
        }
        return false
    }

    private fun install(activity: FlutterActivity, path: String?, result: MethodChannel.Result) {
        val dir = UpdateApkProvider.updatesDir(activity).canonicalFile
        val file = path?.let { File(it).canonicalFile }
        if (file == null || !file.isFile || file.parentFile != dir || !file.name.endsWith(".apk")) {
            result.error("BAD_FILE", "El archivo de la actualización no es válido", null)
            return
        }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(UpdateApkProvider.uriFor(activity, file.name), UpdateApkProvider.APK_MIME)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            activity.startActivity(intent)
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("NO_INSTALLER", "Este equipo no tiene instalador de aplicaciones", null)
        } catch (e: SecurityException) {
            result.error("DENIED", e.message ?: "Instalación no permitida", null)
        }
    }
}
