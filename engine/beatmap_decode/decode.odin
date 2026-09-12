package beatmap_decode

import core_types "../core_types"
import "core:strings"
import "core:unicode/utf8"
import "core:slice"

// The scan and fill passes execute the same parser: validation cannot drift.
// Input is borrowed for this call only. Output strings point into its own arena.
decode :: proc(
	text: string,
	quotas := core_types.DEFAULT_QUOTAS,
	allocator := context.allocator,
) -> (
	result: Map,
	error: core_types.Error,
) {
	if !core_types.valid_quotas(quotas) {
		return {}, {status = .INVALID_ARGUMENT, code = .QUOTAS}
	}
	if u64(len(text)) > quotas.raw_bytes {
		return {}, quota_error(.RAW_BYTES, u64(len(text)), quotas.raw_bytes)
	}
	if !utf8.valid_string(text) {
		return {}, malformed(.UTF8, 0, 0)
	}
	counts: Counts
	candidate: Map
	error = parse(text, quotas, &candidate, &counts, false)
	if error.status != .OK {
		return {}, error
	}
	size := u64(len(text))
	ok: bool
	_, size, ok = core_types.aligned_end(size, counts.objects, size_of(Raw_Object), align_of(Raw_Object))
	if !ok {
		return {}, quota_error(.ARENA_BYTES, core_types.MAX_ADDRESSABLE + 1, quotas.arena_bytes)
	}
	_, size, ok = core_types.aligned_end(size, counts.timing, size_of(Raw_Timing), align_of(Raw_Timing))
	if !ok || size > quotas.arena_bytes {
		return {}, quota_error(.ARENA_BYTES, size, quotas.arena_bytes)
	}
	_, size, ok = core_types.aligned_end(size, counts.breaks, size_of(Break), align_of(Break))
	if !ok || size > quotas.arena_bytes {
		return {}, quota_error(.ARENA_BYTES, size, quotas.arena_bytes)
	}
	_, size, ok = core_types.aligned_end(size, u64(len(candidate.metadata.audio)), 1, 1)
	if !ok || size > quotas.arena_bytes {
		return {}, quota_error(.ARENA_BYTES, size, quotas.arena_bytes)
	}
	arena, status := core_types.arena_create(size, allocator)
	if status != .OK {
		return {}, {status = status}
	}
	committed := false
	defer {
		if !committed {
			core_types.arena_destroy(&arena)
			destroy(&candidate)
		}
	}
	owned, text_ok := core_types.arena_take(&arena, byte, u64(len(text)))
	objects, objects_ok := core_types.arena_take(&arena, Raw_Object, counts.objects)
	timing, timing_ok := core_types.arena_take(&arena, Raw_Timing, counts.timing)
	breaks, breaks_ok := core_types.arena_take(&arena, Break, counts.breaks)
	if !text_ok || !objects_ok || !timing_ok || !breaks_ok {
		return {}, {status = .INTERNAL}
	}
	copy(owned, transmute([]byte)text)
	candidate = Map {
		arena = arena,
		text = string(owned),
		objects = objects,
		timing = timing,
		breaks = breaks,
	}
	arena = {} // Candidate now owns the allocation; failure destroys the candidate.
	filled: Counts
	error = parse(candidate.text, quotas, &candidate, &filled, true)
	if error.status != .OK {
		return {}, error
	}
	audio, audio_ok := core_types.arena_take(&candidate.arena, byte, u64(len(candidate.metadata.audio)))
	if !audio_ok {
		return {}, {status = .INTERNAL}
	}
	copy(audio, candidate.metadata.audio)
	for &character in audio {
		if character == '\\' {
			character = '/'
		}
	}
	candidate.metadata.audio = string(audio)
	for &raw_object, index in candidate.objects {
		explicit := raw_object.flags & 4 != 0
		raw_object.new_combo = explicit
		if raw_object.kind != .SPINNER {
			raw_object.new_combo = explicit || index == 0 || candidate.objects[index - 1].kind == .SPINNER
			raw_object.combo_offset = explicit ? (raw_object.flags >> 4) & 7 : 0
		}
	}
	slice.sort_by(candidate.objects, proc(first_object, second_object: Raw_Object) -> bool {
		return(
			first_object.time_ms < second_object.time_ms ||
			(first_object.time_ms == second_object.time_ms && first_object.id < second_object.id) \
		)
	})
	current_break := 0
	for &raw_object in candidate.objects {
		for current_break < len(candidate.breaks) &&
		    candidate.breaks[current_break].end_ms < raw_object.time_ms {
			raw_object.new_combo = true
			current_break += 1
		}
	}
	committed = true
	return candidate, {}
}

destroy :: proc(decoded_map: ^Map) {
	core_types.arena_destroy(&decoded_map.arena)
	decoded_map^ = {}
}

parse :: proc(
	text: string,
	quotas: core_types.Quotas,
	decoded_map: ^Map,
	counts: ^Counts,
	fill: bool,
) -> core_types.Error {
	decoded_map.difficulty = DEFAULT_DIFFICULTY
	decoded_map.metadata = Metadata {
		title = "Unknown",
		artist = "Unknown",
		creator = "Unknown Creator",
		version = "Normal",
	}
	decoded_map.stack_leniency = f64(f32(0.7))
	decoded_map.general = General {
		preview_time = -1,
		sample_volume = 100,
	}
	cursor := Cursor {
		text = text,
	}
	section := ""
	header := false
	has_ar := false
	for {
		raw, exists := next_line(&cursor)
		if !exists {
			break
		}
		counts.lines += 1
		if counts.lines > quotas.lines {
			return quota_error(.LINES, counts.lines, quotas.lines, cursor.line)
		}
		if cursor.line == 1 && strings.has_prefix(raw, "\xef\xbb\xbf") {
			raw = raw[3:]
		}
		line := strings.trim_space(raw)
		column := u32(strings.index(raw, line) + 1)
		if len(line) == 0 || strings.has_prefix(line, "//") {
			continue
		}
		if !header {
			error := parse_header(line, cursor.line, decoded_map)
			if error.status != .OK {
				return error
			}
			header = true
			continue
		}
		if section != "Metadata" {
			comment := strings.index(line, "//")
			if comment > 0 {
				line = strings.trim_right_space(line[:comment])
			}
		}
		if line[0] == '[' {
			if len(line) < 2 || line[len(line) - 1] != ']' {
				return malformed(.SECTION, cursor.line, column)
			}
			section = line[1:len(line) - 1]
			continue
		}
		switch section {
		case "HitObjects":
			counts.objects += 1
			if counts.objects > quotas.objects {
				return quota_error(.OBJECTS, counts.objects, quotas.objects, cursor.line)
			}
			object, error := parse_object(line, cursor.line, column, decoded_map.format_version, quotas)
			if error.status != .OK {
				return error
			}
			object.id = u32(counts.objects - 1)
			if fill {
				decoded_map.objects[int(counts.objects) - 1] = object
			}
		case "TimingPoints":
			counts.timing += 1
			if counts.timing > quotas.timing_points {
				return quota_error(.TIMING_POINTS, counts.timing, quotas.timing_points, cursor.line)
			}
			point, error := parse_timing(
				line,
				cursor.line,
				column,
				decoded_map.format_version,
				quotas,
				decoded_map.general.sample_set,
				decoded_map.general.sample_volume,
			)
			if error.status != .OK {
				return error
			}
			point.id = u32(counts.timing - 1)
			if fill {
				decoded_map.timing[int(counts.timing) - 1] = point
			}
		case "Events":
			fields := Fields {
				remaining = line,
				column = column,
			}
			kind, _, _ := next_field(&fields)
			if kind == "2" || kind == "Break" {
				start, error := read_number(&fields, cursor.line)
				if error.status != .OK {
					return error
				}
				end, end_err := read_number(&fields, cursor.line)
				if end_err.status != .OK {
					return end_err
				}
				start = offset_time(start, decoded_map.format_version)
				end = max(start, offset_time(end, decoded_map.format_version))
				for time in ([2]f64{start, end}) {
					time_error := validate_time(time, quotas, cursor.line)
					if time_error.status != .OK {
						return time_error
					}
				}
				counts.breaks += 1
				if fill {
					decoded_map.breaks[int(counts.breaks) - 1] = Break{start, end}
				}
			}
		case "General", "Difficulty", "Metadata":
			error := parse_property(decoded_map, section, line, cursor.line, column, &has_ar)
			if error.status != .OK {
				return error
			}
		}
	}
	if !header {
		return malformed(.HEADER, 1, 1)
	}
	if !has_ar {
		decoded_map.difficulty.approach_rate = decoded_map.difficulty.overall_difficulty
	}
	difficulty := &decoded_map.difficulty
	difficulty.health_drain_rate = clamp(difficulty.health_drain_rate, 0, 10)
	difficulty.circle_size = clamp(difficulty.circle_size, 0, 10)
	difficulty.overall_difficulty = clamp(difficulty.overall_difficulty, 0, 10)
	difficulty.approach_rate = clamp(difficulty.approach_rate, 0, 10)
	difficulty.slider_multiplier = clamp(difficulty.slider_multiplier, 0.4, 3.6)
	difficulty.tick_rate = clamp(difficulty.tick_rate, 0.5, 8)
	return {}
}

parse_header :: proc(line: string, line_number: u32, decoded_map: ^Map) -> core_types.Error {
	prefix :: "osu file format v"
	if !strings.has_prefix(line, prefix) {
		return malformed(.HEADER, line_number, 1)
	}
	version, ok := parse_decimal(line[len(prefix):], min(i64), max(i64))
	if !ok {
		return malformed(.HEADER, line_number, u32(len(prefix) + 1))
	}
	if !(version >= 1 && version <= 14) && version != 128 {
		return {.UNSUPPORTED, .FORMAT_VERSION, line_number, u32(len(prefix) + 1), 0, 0}
	}
	decoded_map.format_version = u32(version)
	return {}
}

parse_property :: proc(
	decoded_map: ^Map,
	section, line: string,
	line_number, column: u32,
	has_ar: ^bool,
) -> core_types.Error {
	index := strings.index_byte(line, ':')
	if index < 0 {
		return malformed(.SECTION, line_number, column)
	}
	key := strings.trim_space(line[:index])
	value := strings.trim_space(line[index + 1:])
	value_column :=
		column + u32(index + 1) + u32(len(line[index + 1:]) - len(strings.trim_left_space(line[index + 1:])))
	if section == "Metadata" {
		switch key {
		case "Title":
			decoded_map.metadata.title = value
		case "Artist":
			decoded_map.metadata.artist = value
		case "Creator":
			decoded_map.metadata.creator = value
		case "Version":
			decoded_map.metadata.version = value
		}
		return {}
	}
	if section == "General" {
		switch key {
		case "AudioFilename":
			decoded_map.metadata.audio = value
		case "Mode":
			mode, error := integer(value, line_number, value_column)
			if error.status != .OK {
				return error
			}
			if mode != 0 {
				return {.UNSUPPORTED, .MODE, line_number, value_column, 0, 0}
			}
		case "SampleSet":
			switch value {
			case "None":
				decoded_map.general.sample_set = 0
			case "Normal":
				decoded_map.general.sample_set = 1
			case "Soft":
				decoded_map.general.sample_set = 2
			case "Drum":
				decoded_map.general.sample_set = 3
			case:
				value, error := integer(value, line_number, value_column)
				if error.status != .OK {
					return error
				}
				decoded_map.general.sample_set = value
			}
		case "AudioLeadIn",
		     "PreviewTime",
		     "SampleVolume",
		     "Countdown",
		     "CountdownOffset",
		     "SamplesMatchPlaybackRate",
		     "LetterboxInBreaks",
		     "EpilepsyWarning",
		     "WidescreenStoryboard",
		     "SpecialStyle":

			parsed := value
			if key == "Countdown" {
				switch value {
				case "None":
					parsed = "0"
				case "Normal":
					parsed = "1"
				case "HalfSpeed":
					parsed = "2"
				case "DoubleSpeed":
					parsed = "3"
				}
			}
			value, error := integer(parsed, line_number, value_column)
			if error.status != .OK {
				return error
			}
			switch key {
			case "AudioLeadIn":
				decoded_map.general.audio_lead_in = f64(value)
			case "PreviewTime":
				decoded_map.general.preview_time =
					value == -1 ? -1 : offset_time(f64(value), decoded_map.format_version)
			case "SampleVolume":
				decoded_map.general.sample_volume = value
			case "Countdown":
				decoded_map.general.countdown = value
			case "CountdownOffset":
				decoded_map.general.countdown_offset = value
			case "SamplesMatchPlaybackRate":
				decoded_map.general.samples_match_playback_rate = value == 1
			case "LetterboxInBreaks":
				decoded_map.general.letterbox_in_breaks = value == 1
			case "EpilepsyWarning":
				decoded_map.general.epilepsy_warning = value == 1
			case "WidescreenStoryboard":
				decoded_map.general.widescreen_storyboard = value == 1
			case "SpecialStyle":
				decoded_map.general.special_style = value == 1
			}
		case "StackLeniency":
			value, error := number_f32(value, line_number, value_column)
			if error.status != .OK {
				return error
			}
			decoded_map.stack_leniency = value
		}
		return {}
	}
	target: ^f64
	switch key {
	case "HPDrainRate":
		target = &decoded_map.difficulty.health_drain_rate
	case "CircleSize":
		target = &decoded_map.difficulty.circle_size
	case "OverallDifficulty":
		target = &decoded_map.difficulty.overall_difficulty
	case "ApproachRate":
		target = &decoded_map.difficulty.approach_rate
		has_ar^ = true
	case "SliderMultiplier":
		target = &decoded_map.difficulty.slider_multiplier
	case "SliderTickRate":
		target = &decoded_map.difficulty.tick_rate
	case:
		return {}
	}
	numeric_value: f64
	error: core_types.Error
	if key == "SliderMultiplier" || key == "SliderTickRate" {
		numeric_value, error = number(value, line_number, value_column)
	} else {
		numeric_value, error = number_f32(value, line_number, value_column)
	}
	if error.status != .OK {
		return error
	}
	target^ = numeric_value
	return {}
}
