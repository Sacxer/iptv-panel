package com.iptvplayer.iptv_player

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.net.Inet4Address

/**
 * Redes del equipo con su máscara real y su puerta de enlace, para buscar el portal en redes
 * más grandes que /24 (p. ej. un Wi-Fi 172.27.0.0/19). Solo usa ACCESS_NETWORK_STATE.
 *
 * `localNetworks` → `[{interface, transport, active, addresses: [{address, prefix}], gateways: [..]}]`
 */
object NetworkInfoChannel {
    private const val CHANNEL = "iptv_player/network"

    fun register(context: Context, engine: FlutterEngine) {
        val appContext = context.applicationContext
        MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "localNetworks" -> {
                    try {
                        result.success(localNetworks(appContext))
                    } catch (e: Exception) {
                        result.error("NETWORK_INFO", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun localNetworks(context: Context): List<Map<String, Any?>> {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val active = cm.activeNetwork
        @Suppress("DEPRECATION")
        val networks = try {
            cm.allNetworks.toList()
        } catch (e: Exception) {
            listOfNotNull(active)
        }
        val out = mutableListOf<Map<String, Any?>>()
        for (network in networks) {
            val link = cm.getLinkProperties(network) ?: continue
            val caps = cm.getNetworkCapabilities(network)
            val transport = when {
                caps == null -> "other"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                else -> "other"
            }
            val addresses = link.linkAddresses
                .filter { it.address is Inet4Address }
                .map { mapOf("address" to it.address.hostAddress, "prefix" to it.prefixLength) }
            val gateways = link.routes
                .filter { it.isDefaultRoute && it.gateway is Inet4Address }
                .mapNotNull { it.gateway?.hostAddress }
            out += mapOf(
                "interface" to link.interfaceName,
                "transport" to transport,
                "active" to (network == active),
                "addresses" to addresses,
                "gateways" to gateways,
            )
        }
        return out
    }
}
