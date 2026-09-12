// Copyright (c) ppy Pty Ltd. MIT; source-informed legacy sample preparation.
package osu_prepare

import prepared "../prepared"
import beatmap_decode "../beatmap_decode"
import "core:strings"
import "core:fmt"

Sample_Bank :: struct {
	normal, addition, custom, volume: i32,
	filename: string,
}

parse_bank :: proc(text: string, bank: Sample_Bank = {}, banks_only := false) -> Sample_Bank {
	if len(text) == 0 {
		return bank
	}
	result := bank
	fields := beatmap_decode.Fields {
		remaining = text,
	}
	for index in 0 ..< 5 {
		token, _, exists := beatmap_decode.next_field(&fields, ':')
		if !exists {
			break
		}
		if index == 4 {
			result.filename = token
			break
		}
		parsed_value, valid := beatmap_decode.parse_decimal(token, -2147483647, 2147483647)
		// Public preparation consumes validated decoded records.
		if !valid {
			return bank
		}
		value := i32(parsed_value)
		switch index {
		case 0:
			result.normal = value
			if value < 0 || value > 3 {
				result.normal = 1
			}
		case 1:
			result.addition = value
			if value < 0 || value > 3 {
				result.addition = 1
			}
		case 2:
			if !banks_only {
				result.custom = value
			}
		case 3:
			if !banks_only {
				result.volume = max(0, value)
			}
		}
		if index == 1 && banks_only {
			break
		}
	}
	if result.addition == 0 {
		result.addition = result.normal
	}
	return result
}

bank_name :: proc(bank: i32) -> string {
	switch bank {
	case 2:
		return "soft"
	case 3:
		return "drum"
	case:
		return "normal"
	}
}

make_samples :: proc(
	builder: ^Map_Builder,
	sound: u32,
	bank: Sample_Bank,
	point: Point,
	override_name: string = "",
	selected_bit: u32 = 0,
) -> []prepared.Sample {
	count: u64 = 1
	if sound & 4 != 0 {
		count += 1
	}
	if sound & 2 != 0 {
		count += 1
	}
	if sound & 8 != 0 {
		count += 1
	}
	if selected_bit != 0 {
		count = 1
	}
	samples := map_take(builder, prepared.Sample, count)
	sample_index := 0
	for bit in ([4]u32{1, 4, 2, 8}) {
		if selected_bit != 0 && bit != selected_bit {
			continue
		}
		if bit != 1 && sound & bit == 0 {
			continue
		}
		sample_name := "hitnormal"
		switch bit {
		case 4:
			sample_name = "hitfinish"
		case 2:
			sample_name = "hitwhistle"
		case 8:
			sample_name = "hitclap"
		}
		if len(override_name) > 0 {
			sample_name = override_name
		}
		selected_bank := bank.normal
		if bit != 1 {
			selected_bank = bank.addition
		}
		if selected_bank == 0 {
			selected_bank = point.sample_set
		}
		custom := bank.custom
		if custom <= 0 {
			custom = point.sample_index
		}
		volume := bank.volume
		if volume <= 0 {
			volume = point.volume
		}
		is_file := bit == 1 && len(bank.filename) > 0
		if is_file {
			selected_bank = 1
			custom = 1
			sample_name = "hitnormal"
		}
		suffix_buffer: [32]byte
		suffix := ""
		if custom >= 2 {
			suffix = fmt.bprintf(suffix_buffer[:], "%d", custom)
		}
		candidate_count := 2
		if custom >= 2 {
			candidate_count += 1
		}
		if is_file {
			candidate_count += 2
		}
		candidates := map_take(builder, string, u64(candidate_count))
		candidate_index := 0
		if is_file {
			for filename in ([2]string{bank.filename, strip_extension(bank.filename)}) {
				owned := map_string(builder, filename)
				if builder.fill && builder.error.status == .OK {
					candidates[candidate_index] = owned
				}
				candidate_index += 1
			}
		}
		name_buffer: [128]byte
		if custom >= 2 {
			candidate := map_string(
				builder,
				fmt.bprintf(
					name_buffer[:],
					"Gameplay/%s-%s%s",
					bank_name(selected_bank),
					sample_name,
					suffix,
				),
			)
			if builder.fill && builder.error.status == .OK {
				candidates[candidate_index] = candidate
			}
			candidate_index += 1
		}
		candidate := map_string(
			builder,
			fmt.bprintf(name_buffer[:], "Gameplay/%s-%s", bank_name(selected_bank), sample_name),
		)
		if builder.fill && builder.error.status == .OK {
			candidates[candidate_index] = candidate
		}
		candidate_index += 1
		candidate = map_string(builder, fmt.bprintf(name_buffer[:], "Gameplay/%s", sample_name))
		if builder.fill && builder.error.status == .OK {
			candidates[candidate_index] = candidate
		}
		sample := prepared.Sample {
			name = sample_name,
			bank = bank_name(selected_bank),
			suffix = map_string(builder, suffix),
			volume = volume,
			use_beatmap = custom >= 1,
			layered = bit == 1 && !is_file && sound != 0 && sound & 1 == 0,
			candidates = candidates,
		}
		if builder.fill && builder.error.status == .OK {
			samples[sample_index] = sample
		}
		sample_index += 1
	}
	return samples
}

strip_extension :: proc(filename: string) -> string {
	last_dot := -1
	for character, index in filename {
		if character == '.' {
			last_dot = index
		}
		if character == '/' || character == '\\' {
			last_dot = -1
		}
	}
	return last_dot >= 0 ? filename[:last_dot] : filename
}

// Parse each node list once per object/pass, rather than rescanning from node 0.
prepare_node_fields :: proc(raw_object: ^beatmap_decode.Raw_Object, banks: []Sample_Bank, sounds: []u32) {
	default_bank := parse_bank(raw_object.hit_sample, {}, true)
	bank_fields := beatmap_decode.Fields {
		remaining = raw_object.edge_sets,
	}
	sound_fields := beatmap_decode.Fields {
		remaining = raw_object.edge_sounds,
	}
	for node_index in 0 ..< int(raw_object.spans) + 1 {
		banks[node_index] = default_bank
		sounds[node_index] = raw_object.hit_sound
		if len(raw_object.edge_sets) > 0 {
			token, _, exists := beatmap_decode.next_field(&bank_fields, '|')
			if exists {
				banks[node_index] = parse_bank(token, default_bank)
			}
		}
		if len(raw_object.edge_sounds) > 0 {
			token, _, exists := beatmap_decode.next_field(&sound_fields, '|')
			if exists {
				sounds[node_index] = u32(beatmap_decode.edge_sound_value(token))
			}
		}
	}
}

node_samples :: proc(
	builder: ^Map_Builder,
	scratch: ^Prepare_Scratch,
	node_index: u32,
	point: Point,
) -> []prepared.Sample {
	return make_samples(builder, scratch.node_sounds[node_index], scratch.node_banks[node_index], point)
}

sample_count :: proc(sound: u32) -> u64 {
	return 1 + u64(sound & 4 != 0) + u64(sound & 2 != 0) + u64(sound & 8 != 0)
}

slider_auxiliary :: proc(
	builder: ^Map_Builder,
	raw: ^beatmap_decode.Raw_Object,
	bank: Sample_Bank,
	point: Point,
	tail: []prepared.Sample,
	tail_count: u64,
) -> []prepared.Sample {
	result := map_take(builder, prepared.Sample, 1 + u64(raw.hit_sound & 2 != 0) + tail_count)
	slide := make_samples(builder, raw.hit_sound, bank, point, "sliderslide", 1)
	whistle: []prepared.Sample
	if raw.hit_sound & 2 != 0 {
		whistle = make_samples(builder, raw.hit_sound, bank, point, "sliderwhistle", 2)
	}
	if builder.fill && builder.error.status == .OK {
		result[0] = slide[0]
		index := 1
		if len(whistle) > 0 {
			result[index] = whistle[0]
			index += 1
		}
		copy(result[index:], tail)
	}
	return result
}
