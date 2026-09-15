package simulation

// Player.Resume / BreakTracker / OsuResumeOverlay.PopIn at the pinned revision.
// Cursor visibility and containment are observations supplied by the platform.
resume_requires_cursor :: proc(session: ^Session, cursor_visible, cursor_inside: bool) -> bool {
	if !cursor_visible || !cursor_inside || terminal(session) {
		return false
	}
	time_ms := session.committed_ms
	if time_ms < session.prepared_map.objects[0].time_ms - 2000 {
		return false
	}
	for period in session.prepared_map.breaks {
		if period.end_ms - period.start_ms >= 650 && time_ms >= period.start_ms && time_ms <= period.end_ms - 325 {
			return false
		}
	}
	return true
}
