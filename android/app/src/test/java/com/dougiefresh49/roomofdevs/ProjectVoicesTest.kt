package com.dougiefresh49.roomofdevs

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ProjectVoicesTest {
    @Test fun decodesPayloadInDaemonOrderAndIgnoresNewFields() {
        val payload = wireJson.decodeFromString<ProjectVoicesPayload>("""
            {"projects":[
              {"name":"comic-reader","dir":"/Users/x/projects/comic-reader","lastActivityAt":"2026-10-02T10:00:00Z","voiceId":"v-mikey","character":"Michelangelo","extra":1},
              {"name":"fleet","dir":"/Users/x/projects/fleet","lastActivityAt":null,"voiceId":null,"character":null}
            ],
            "characters":[{"voiceId":"v-donnie","name":"Donatello","avatar":"x"},{"voiceId":"v-mikey","name":"Michelangelo"}],
            "version":2}
        """).usable()
        assertEquals(listOf("comic-reader", "fleet"), payload.projects.map { it.name })
        assertEquals("Michelangelo", payload.projects[0].voiceLabel)
        assertEquals("Default", payload.projects[1].voiceLabel)
        assertNull(payload.projects[1].lastActivityAt)
        assertEquals(listOf("Donatello", "Michelangelo"), payload.characters.map { it.name })
    }
    @Test fun defaultsMissingFieldsAndDropsUnusableRows() {
        val payload = wireJson.decodeFromString<ProjectVoicesPayload>("""
            {"projects":[{"name":"repo"},{"dir":"/nowhere"},{"name":"set","voiceId":"v-gone"}],
             "characters":[{"name":"No voice"},{"voiceId":"v-1"},{"voiceId":"v-2","name":"Raphael"}]}
        """).usable()
        assertEquals(listOf("repo", "set"), payload.projects.map { it.name })
        assertNull(payload.projects[0].dir)
        assertEquals("Default", payload.projects[0].voiceLabel)
        assertEquals("Custom voice", payload.projects[1].voiceLabel)
        assertEquals(listOf(VoiceCharacter("v-2", "Raphael")), payload.characters)
        assertEquals(ProjectVoicesPayload(), wireJson.decodeFromString<ProjectVoicesPayload>("{}"))
    }
    @Test fun loadsWithCookieAndSavesOrSurfacesRejection() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"projects":[{"name":"fleet"}],"characters":[]}"""))
            server.enqueue(MockResponse().setBody("""{"ok":true}"""))
            server.enqueue(MockResponse().setBody("""{"ok":false,"error":"unknown voice"}"""))
            val api = RoomApi(Connection.parse(server.url("/?t=testtoken").toString()))
            assertEquals("fleet", api.projectVoices().projects.single().name)
            val get = server.takeRequest()
            assertEquals("/project-voices", get.path)
            assertEquals("mobile_token=testtoken", get.getHeader("Cookie"))
            api.setProjectVoice("fleet", "")
            val post = server.takeRequest()
            assertEquals("/action", post.path)
            assertEquals(buildJsonObject { put("type", "set_project_voice"); put("project", "fleet"); put("voiceId", "") },
                wireJson.parseToJsonElement(post.body.readUtf8()))
            assertTrue(runCatching { api.setProjectVoice("fleet", "v-1") }.isFailure)
        }
    }
    @Test fun charactersRoundTripThroughThePickerIntentExtra() {
        val chars = listOf(VoiceCharacter("v-1", "Donatello"), VoiceCharacter("v-2", "Karai"))
        val serializer = ListSerializer(VoiceCharacter.serializer())
        assertEquals(chars, wireJson.decodeFromString(serializer, wireJson.encodeToString(serializer, chars)))
    }
}
