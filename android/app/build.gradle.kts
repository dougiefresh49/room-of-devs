plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}
val revisionCount = runCatching {
    providers.exec { commandLine("git", "rev-list", "--count", "HEAD") }.standardOutput.asText.get().trim().toInt()
}.getOrDefault(1)
val signingValues = listOf("ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
    .map { providers.environmentVariable(it).orNull }
android {
    namespace = "com.dougiefresh49.roomofdevs"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.dougiefresh49.roomofdevs"
        minSdk = 31
        targetSdk = 35
        versionCode = revisionCount
        versionName = "0.1.$revisionCount"
    }
    signingConfigs {
        if (signingValues.all { !it.isNullOrBlank() }) create("release") {
            storeFile = file(signingValues[0]!!)
            storePassword = signingValues[1]
            keyAlias = signingValues[2]
            keyPassword = signingValues[3]
        }
    }
    buildTypes { release { signingConfig = signingConfigs.findByName("release") } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["test"].resources.srcDir("../../packages/protocol/fixtures")
}
dependencies {
    val media3 = "1.6.1"
    implementation("androidx.media3:media3-session:$media3")
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
