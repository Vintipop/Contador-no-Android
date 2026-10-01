plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.contador.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.contador.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 6
        versionName = "2.2"
    }

    signingConfigs {
        create("contador") {
            storeFile = file("../keystore/contador.keystore")
            storePassword = "contador123"
            keyAlias = "contador"
            keyPassword = "contador123"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("contador")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("contador")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Servidor HTTP embutido - substitui o app.py rodando dentro do próprio app
    implementation("org.nanohttpd:nanohttpd:2.3.1")
}
