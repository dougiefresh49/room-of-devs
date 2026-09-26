package com.dougiefresh49.roomofdevs

import android.content.Context

object ConnectionPrefs {
    fun prefs(context: Context) = context.getSharedPreferences("room", Context.MODE_PRIVATE)
    fun load(context: Context): Connection? {
        val p = prefs(context)
        val base = p.getString("base", null) ?: return null
        val token = p.getString("token", null) ?: return null
        return runCatching { Connection.parse("$base?t=$token") }.getOrNull()
    }
    /** Same multiplier steps as the mobile page's speed control (prefs.ts SPEED_STEPS). */
    val SPEED_STEPS = listOf(1.0, 1.25, 1.5, 1.75, 2.0)
    const val SPEED_KEY = "speed_mult"
    fun speed(context: Context): Double =
        prefs(context).getFloat(SPEED_KEY, 1f).toDouble().takeIf { it in SPEED_STEPS } ?: 1.0
    fun saveSpeed(context: Context, speed: Double) { prefs(context).edit().putFloat(SPEED_KEY, speed.toFloat()).apply() }
    fun save(context: Context, connection: Connection) {
        prefs(context).edit().putString("base", connection.base.toString()).putString("token", connection.token).apply()
    }
}
