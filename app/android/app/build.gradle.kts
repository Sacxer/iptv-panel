import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Firma de publicación: android/key.properties (storeFile, storePassword, keyAlias, keyPassword).
// No se sube a git. Si falta, se firma con la clave de depuración y se avisa (la compilación no falla).
val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties().apply {
    if (keyPropertiesFile.isFile) keyPropertiesFile.inputStream().use { load(it) }
}
val releaseStoreFile = keyProperties.getProperty("storeFile")?.let { rootProject.file(it) }
val hasReleaseKey = releaseStoreFile?.isFile == true &&
    !keyProperties.getProperty("storePassword").isNullOrEmpty() &&
    !keyProperties.getProperty("keyAlias").isNullOrEmpty()

android {
    // Paquete del código Kotlin (MainActivity). No necesita coincidir con applicationId.
    namespace = "com.iptvplayer.iptv_player"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // ID del paquete instalado. Play y Portal usan el mismo (misma app, misma firma).
        applicationId = "com.iptvplayer.app"
        // media_kit requiere API 21+; Flutter usa 24 como mínimo.
        minSdk = maxOf(flutter.minSdkVersion, 24)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = keyProperties.getProperty("storePassword")
                keyAlias = keyProperties.getProperty("keyAlias")
                keyPassword = keyProperties.getProperty("keyPassword")
                    ?: keyProperties.getProperty("storePassword")
            }
        }
    }

    // Dos distribuciones de la misma app (mismo applicationId y firma):
    //  - play:   Google Play (.aab). Sin permiso de instalación ni actualizador propio.
    //  - portal: APK para celulares y TV box, actualizado desde el portal. Con REQUEST_INSTALL_PACKAGES
    //            y actualizador (src/portal/AndroidManifest.xml y src/portal/kotlin).
    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
        }
        create("portal") {
            dimension = "distribution"
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                logger.warn(
                    "\nAVISO: no se encontró android/key.properties o la llave que indica. " +
                        "La versión release se firmará con la CLAVE DE DEPURACIÓN: sirve para probar, " +
                        "pero no para Google Play ni para actualizar equipos instalados con la llave oficial.\n"
                )
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
