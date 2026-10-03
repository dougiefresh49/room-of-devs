package com.dougiefresh49.roomofdevs

import org.junit.Assert.*
import org.junit.Test

class BrowseTreeTest {
    private fun agent(id: String, project: String?, state: String = "idle", character: String? = "Donatello", at: String? = null, failed: Boolean = false) =
        Agent(id, id, state = state, character = character, project = project, lastActivityAt = at, failed = failed)

    private val comicA = agent("comic-a", "comic-reader", "working", "Michelangelo", "2026-10-02T10:00:00Z")
    private val comicB = agent("comic-b", "comic-reader", "idle", "Michelangelo", "2026-10-02T09:00:00Z")
    private val comicC = agent("comic-c", "comic-reader", "hand_raised", "Donatello", "2026-10-02T08:00:00Z")
    private val cra = agent("cra-1", "cursor-read-aloud", "speaking", "Donatello", "2026-10-02T09:30:00Z")
    private val jobs = agent("jobs-1", "job-search-2026", "idle", "Karai", "2026-10-01T12:00:00Z", failed = true)

    @Test fun statusWordsErrorWins() {
        assertEquals(Status.WORKING, comicA.status)
        assertEquals(Status.DONE, comicB.status)
        assertEquals(Status.DONE, comicC.status)
        assertEquals(Status.DONE, cra.status)
        assertEquals(Status.ERROR, jobs.status)
        assertEquals(Status.ERROR, comicA.copy(failed = true).status)
        assertEquals("Working", Status.WORKING.label); assertEquals("Done", Status.DONE.label); assertEquals("Error", Status.ERROR.label)
    }
    @Test fun failedDefaultsFalseAndParsesWhenPresent() {
        val missing = wireJson.decodeFromString<Agent>("""{"sessionId":"s","name":"n","state":"idle"}""")
        assertFalse(missing.failed)
        val present = wireJson.decodeFromString<Agent>("""{"sessionId":"s","name":"n","state":"idle","failed":true}""")
        assertEquals(Status.ERROR, present.status)
    }
    @Test fun groupsByProjectOrderedByMostRecentActivity() {
        val projects = BrowseTree.projects(listOf(jobs, comicC, cra, comicB, comicA))
        assertEquals(listOf("comic-reader", "cursor-read-aloud", "job-search-2026"), projects.map { it.name })
        assertEquals(listOf(comicA, comicB, comicC), projects[0].agents)
        assertEquals(listOf("project:comic-reader", "project:cursor-read-aloud", "project:job-search-2026"), projects.map { it.id })
    }
    @Test fun projectArtIsTheMostCommonCharacterTiesToMostRecent() {
        assertEquals("Michelangelo", BrowseTree.projects(listOf(comicA, comicB, comicC))[0].character)
        // One each: the most recently active thread's character wins.
        assertEquals("Michelangelo", BrowseTree.projects(listOf(comicA, comicC))[0].character)
        assertEquals("Donatello", BrowseTree.projects(listOf(comicC, comicA.copy(lastActivityAt = "2026-10-02T07:00:00Z")))[0].character)
        assertNull(BrowseTree.projects(listOf(cra.copy(character = null)))[0].character)
    }
    @Test fun projectlessThreadsFallBackToCharacterThenOther() {
        val byCharacter = agent("x", null, character = "Raphael")
        val nobody = agent("y", null, character = null)
        val blank = agent("z", "  ", character = "")
        val names = BrowseTree.projects(listOf(byCharacter, nobody, blank)).map { it.name }
        assertEquals(setOf("Raphael", BrowseTree.OTHER), names.toSet())
        assertEquals(listOf(nobody, blank), BrowseTree.project(listOf(byCharacter, nobody, blank), BrowseTree.OTHER)?.agents?.sortedBy { it.sessionId })
    }
    @Test fun summaryCountsErrorsFirstAndSkipsZeroes() {
        assertEquals("1 working · 2 done", BrowseTree.projects(listOf(comicA, comicB, comicC))[0].summary)
        assertEquals("1 done", BrowseTree.projects(listOf(cra))[0].summary)
        assertEquals("1 error", BrowseTree.projects(listOf(jobs))[0].summary)
        assertEquals("1 error · 1 working", BrowseTree.projects(listOf(comicA, comicB.copy(failed = true)))[0].summary)
    }
    @Test fun mediaIdsRoundTrip() {
        assertEquals("thread:abc", BrowseTree.threadId("abc"))
        assertEquals("abc", BrowseTree.sessionId("thread:abc"))
        assertEquals("comic-reader", BrowseTree.projectName("project:comic-reader"))
        assertNull(BrowseTree.projectName("thread:abc"))
        assertNull(BrowseTree.sessionId("project:x"))
        assertNull(BrowseTree.sessionId("room"))
    }
    @Test fun firstSnapshotNotifiesTheGridAndEveryProject() {
        val projects = BrowseTree.projects(listOf(comicA, cra))
        assertEquals(setOf("room", "project:comic-reader", "project:cursor-read-aloud"), BrowseTree.changedParents(null, projects))
    }
    @Test fun threadFlippingWorkingToDoneNotifiesItsProjectAndTheGrid() {
        val before = BrowseTree.projects(listOf(comicA, comicB, cra))
        val after = BrowseTree.projects(listOf(comicA.copy(state = "idle"), comicB, cra))
        assertEquals(setOf("project:comic-reader", "room"), BrowseTree.changedParents(before, after))
    }
    @Test fun identicalSnapshotsNotifyNothing() {
        val before = BrowseTree.projects(listOf(comicA, comicB, cra))
        val after = BrowseTree.projects(listOf(cra, comicB, comicA))
        assertTrue(BrowseTree.changedParents(before, after).isEmpty())
    }
    @Test fun threadsAppearingAndProjectsVanishingNotifyBothLevels() {
        val before = BrowseTree.projects(listOf(comicA, cra))
        val added = BrowseTree.projects(listOf(comicA, cra, jobs))
        assertEquals(setOf("project:job-search-2026", "room"), BrowseTree.changedParents(before, added))
        val gone = BrowseTree.projects(listOf(comicA))
        assertEquals(setOf("project:cursor-read-aloud", "room"), BrowseTree.changedParents(before, gone))
        val newThread = BrowseTree.projects(listOf(comicA, comicB, cra))
        assertEquals(setOf("project:comic-reader", "room"), BrowseTree.changedParents(before, newThread))
    }
    @Test fun activityReorderingProjectsNotifiesTheGridOnly() {
        val before = BrowseTree.projects(listOf(comicA, cra))
        val after = BrowseTree.projects(listOf(comicA, cra.copy(lastActivityAt = "2026-10-02T11:00:00Z")))
        // cursor-read-aloud's own row changed (activity timestamp), and the grid order moved.
        assertEquals(setOf("project:cursor-read-aloud", "room"), BrowseTree.changedParents(before, after))
        val sameRows = BrowseTree.projects(listOf(comicA, cra))
        assertTrue(BrowseTree.changedParents(after, sameRows).contains("room"))
    }
    @Test fun realFixtureGroupsEveryThread() {
        val fixture = requireNotNull(javaClass.classLoader?.getResource("panel-snapshot.json")).readText()
        val snapshot = wireJson.decodeFromString<Snapshot>(fixture)
        val projects = BrowseTree.projects(snapshot.agents)
        assertEquals(snapshot.agents.size, projects.sumOf { it.agents.size })
        assertTrue(projects.any { it.name == "podlink-mui-ref" })
        assertTrue(projects.all { it.summary.isNotBlank() })
    }
}
