package com.dougiefresh49.roomofdevs

import android.content.Context

object ConnectionPrefs {
    private fun prefs(context: Context) = context.getSharedPreferences("room", Context.MODE_PRIVATE)
    fun load(context: Context): Connection? {
        val p = prefs(context)
        val base = p.getString("base", null) ?: return null
        val token = p.getString("token", null) ?: return null
        return runCatching { Connection.parse("$base?t=$token") }.getOrNull()
    }
    fun save(context: Context, connection: Connection) {
        prefs(context).edit().putString("base", connection.base.toString()).putString("token", connection.token).apply()
    }
}
