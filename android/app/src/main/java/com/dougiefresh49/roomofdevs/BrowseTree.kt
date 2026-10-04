package com.dougiefresh49.roomofdevs

/**
 * The car's browse tree, as pure data: root -> Room (one grid tile per project) -> project
 * (an album-style list, one row per thread). Media IDs: [ROOT], [ROOM], `project:<name>`,
 * `thread:<sessionId>`. Keeping this free of Android types is what makes it unit-testable.
 */
object BrowseTree {
    const val ROOT = "root"
    const val ROOM = "room"
    const val PROJECT_PREFIX = "project:"
    const val THREAD_PREFIX = "thread:"
    /** Threads with no project and no character. */
    const val OTHER = "Other"

    fun projectId(name: String) = PROJECT_PREFIX + name
    fun threadId(sessionId: String) = THREAD_PREFIX + sessionId
    fun projectName(mediaId: String): String? = mediaId.takeIf { it.startsWith(PROJECT_PREFIX) }?.removePrefix(PROJECT_PREFIX)
    fun sessionId(mediaId: String): String? = mediaId.takeIf { it.startsWith(THREAD_PREFIX) }?.removePrefix(THREAD_PREFIX)

    /** Projects usually share one voice; the fallback keeps a project-less thread near its character. */
    fun projectOf(agent: Agent): String = agent.project?.takeIf { it.isNotBlank() } ?: agent.character?.takeIf { it.isNotBlank() } ?: OTHER

    /** Groups in [roomOrder] of their most recent thread; threads inside a group keep that order too. */
    fun projects(agents: List<Agent>): List<ProjectGroup> = roomOrder(agents).groupBy(::projectOf).map { (name, members) ->
        // Most common character wins; ties go to the most recently active thread's character.
        val character = members.mapNotNull { it.character }.groupingBy { it }.eachCount()
            .entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }
                .thenBy { entry -> members.indexOfFirst { it.character == entry.key } })
            .firstOrNull()?.key
        ProjectGroup(name, character, members)
    }

    fun project(agents: List<Agent>, name: String): ProjectGroup? = projects(agents).find { it.name == name }

    /**
     * Parents whose children (or their summaries) differ between two snapshots, so each can be
     * re-requested by a subscribed browser. A thread flipping state changes its project's row
     * list and the Room grid's subtitle, so both are returned. ROOT's only child is the static
     * Room folder, so it never changes.
     */
    fun changedParents(previous: List<ProjectGroup>?, next: List<ProjectGroup>): Set<String> {
        if (previous == null) return setOf(ROOM) + next.map { it.id }
        val before = previous.associateBy { it.name }
        val after = next.associateBy { it.name }
        val changed = (before.keys + after.keys).filter { before[it] != after[it] }.map(::projectId).toMutableSet()
        if (changed.isNotEmpty() || previous.map { it.tile } != next.map { it.tile }) changed += ROOM
        return changed
    }
}

data class ProjectGroup(val name: String, val character: String?, val agents: List<Agent>) {
    val id get() = BrowseTree.projectId(name)
    /** Status counts at a glance, errors first: "1 error · 2 working · 3 done". */
    val summary: String get() = listOf(Status.ERROR, Status.WORKING, Status.DONE)
        .map { status -> status to agents.count { it.status == status } }
        .filter { it.second > 0 }
        .joinToString(" · ") { (status, count) -> "$count ${status.label.lowercase()}" }
    /** What the Room grid shows for this project; a change here needs the grid re-requested. */
    val tile get() = Triple(name, character, summary)
}
