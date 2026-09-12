package replay

import "core:crypto/sha2"
import core_types "../core_types"

// Internal replay v2 codec, not a production ABI export. All integers are LE.
HEADER_BYTES :: 192
FRAME_BYTES :: 64
CHECKSUM_BYTES :: 32
Decoded :: struct {
	identity: Identity,
	final_digest: [32]byte,
	frames: []core_types.Input_Snapshot,
}

encoded_size :: proc(frame_count: u64) -> (u64, core_types.Status) {
	if frame_count > MAX_FRAMES {
		return 0, .QUOTA_EXCEEDED
	}
	payload_byte_count, payload_fits := core_types.checked_product(frame_count, FRAME_BYTES)
	if !payload_fits {
		return 0, .QUOTA_EXCEEDED
	}
	total_byte_count, size_fits := core_types.checked_add(payload_byte_count, HEADER_BYTES + CHECKSUM_BYTES)
	return total_byte_count, size_fits ? core_types.Status.OK : core_types.Status.QUOTA_EXCEEDED
}

@(private)
put_integer :: proc(bytes: []byte, offset, byte_count: int, integer_value: u64) {
	for byte_index in 0 ..< byte_count {
		bytes[offset + byte_index] = byte(integer_value >> u32(byte_index * 8))
	}
}

@(private)
get_integer :: proc(bytes: []byte, offset, byte_count: int) -> u64 {
	integer_value: u64
	for byte_index in 0 ..< byte_count {
		integer_value |= u64(bytes[offset + byte_index]) << u32(byte_index * 8)
	}
	return integer_value
}

@(private)
put_float :: proc(bytes: []byte, offset: int, float_value: f64) {
	// Canonicalize signed zero; NaN/Infinity are rejected before serialization.
	canonical_value := float_value == 0 ? f64(0) : float_value
	put_integer(bytes, offset, 8, transmute(u64)canonical_value)
}

@(private)
get_float :: proc(bytes: []byte, offset: int) -> f64 {
	return transmute(f64)get_integer(bytes, offset, 8)
}

@(private)
digest :: proc(bytes: []byte) -> [32]byte {
	hasher: sha2.Context_256
	result: [32]byte
	sha2.init_256(&hasher)
	sha2.update(&hasher, bytes)
	sha2.final(&hasher, result[:])
	return result
}

encode :: proc(
	identity: Identity,
	frames: []core_types.Input_Snapshot,
	final_digest: [32]byte,
	output: []byte,
) -> (
	u64,
	core_types.Status,
) {
	required_bytes, status := encoded_size(u64(len(frames)))
	if status != .OK {
		return required_bytes, status
	}
	status = validate_identity(identity, identity)
	if status != .OK {
		return required_bytes, status
	}
	status, _ = validate_frames(frames)
	if status != .OK {
		return required_bytes, status
	}
	if u64(len(output)) < required_bytes {
		return required_bytes, .OUTPUT_REQUIRED
	}
	if core_types.buffers_overlap(
		raw_data(frames),
		u64(len(frames)) * size_of(core_types.Input_Snapshot),
		raw_data(output),
		required_bytes,
	) {
		return required_bytes, .INVALID_ARGUMENT
	}
	bytes := output[:int(required_bytes)]
	for &output_byte in bytes {
		output_byte = 0
	}
	copy(bytes[:8], "TWREPLAY")
	put_integer(bytes, 8, 4, u64(identity.schema_version))
	put_integer(bytes, 12, 4, HEADER_BYTES)
	put_integer(bytes, 16, 4, u64(identity.compatibility_version))
	put_integer(bytes, 20, 4, u64(identity.rules_version))
	put_integer(bytes, 24, 4, u64(identity.behavior_id))
	put_integer(bytes, 28, 4, u64(identity.coordinate_version))
	// 32: flags=0 (unmodded osu only), 36: stride, 40: count, 44: reserved.
	put_integer(bytes, 36, 4, FRAME_BYTES)
	put_integer(bytes, 40, 4, u64(len(frames)))
	put_float(bytes, 48, identity.rate)
	for offset_ms, offset_index in identity.offsets {
		put_float(bytes, 56 + offset_index * 8, offset_ms)
	}
	for digest_byte, byte_index in identity.raw_digest {
		bytes[88 + byte_index] = digest_byte
	}
	for digest_byte, byte_index in identity.prepared_digest {
		bytes[120 + byte_index] = digest_byte
	}
	for digest_byte, byte_index in final_digest {
		bytes[152 + byte_index] = digest_byte
	}
	for frame, frame_index in frames {
		frame_offset := HEADER_BYTES + frame_index * FRAME_BYTES
		put_integer(bytes, frame_offset, 8, frame.sequence)
		put_float(bytes, frame_offset + 8, frame.raw_time_ms)
		put_float(bytes, frame_offset + 16, frame.effective_time_ms)
		put_float(bytes, frame_offset + 24, frame.x)
		put_float(bytes, frame_offset + 32, frame.y)
		put_integer(bytes, frame_offset + 40, 4, u64(frame.action_bits))
		put_integer(bytes, frame_offset + 44, 2, u64(frame.source))
		put_integer(bytes, frame_offset + 46, 2, u64(frame.focus_epoch))
		put_integer(bytes, frame_offset + 48, 4, u64(frame.flags))
	}
	checksum := digest(bytes[:len(bytes) - CHECKSUM_BYTES])
	copy(bytes[len(bytes) - CHECKSUM_BYTES:], checksum[:])
	return required_bytes, .OK
}

@(private)
read_frame :: proc(bytes: []byte, frame_offset: int) -> core_types.Input_Snapshot {
	return {
		sequence = get_integer(bytes, frame_offset, 8),
		raw_time_ms = get_float(bytes, frame_offset + 8),
		effective_time_ms = get_float(bytes, frame_offset + 16),
		x = get_float(bytes, frame_offset + 24),
		y = get_float(bytes, frame_offset + 32),
		action_bits = u32(get_integer(bytes, frame_offset + 40, 4)),
		source = u16(get_integer(bytes, frame_offset + 44, 2)),
		focus_epoch = u16(get_integer(bytes, frame_offset + 46, 2)),
		flags = u32(get_integer(bytes, frame_offset + 48, 4)),
	}
}

// Decode validates checksum, identity and every frame before writing output.
// It borrows the destination; failure leaves destination bytes unchanged.
decode :: proc(
	bytes: []byte,
	expected: Identity,
	output: []core_types.Input_Snapshot,
) -> (
	Decoded,
	core_types.Status,
) {
	if len(bytes) < HEADER_BYTES + CHECKSUM_BYTES || string(bytes[:8]) != "TWREPLAY" {
		return {}, .INVALID_ARGUMENT
	}
	if get_integer(bytes, 8, 4) != SCHEMA_VERSION ||
	   get_integer(bytes, 12, 4) != HEADER_BYTES ||
	   get_integer(bytes, 32, 4) != 0 ||
	   get_integer(bytes, 36, 4) != FRAME_BYTES {
		return {}, .UNSUPPORTED
	}
	frame_count := get_integer(bytes, 40, 4)
	required_bytes, status := encoded_size(frame_count)
	if status != .OK {
		return {}, status
	}
	if required_bytes != u64(len(bytes)) {
		return {}, .INVALID_ARGUMENT
	}
	if get_integer(bytes, 44, 4) != 0 || get_integer(bytes, 184, 8) != 0 {
		return {}, .INVALID_ARGUMENT
	}
	checksum := digest(bytes[:len(bytes) - CHECKSUM_BYTES])
	for checksum_byte, byte_index in checksum {
		if checksum_byte != bytes[len(bytes) - CHECKSUM_BYTES + byte_index] {
			return {}, .INVALID_ARGUMENT
		}
	}
	identity := Identity {
		schema_version = u32(get_integer(bytes, 8, 4)),
		compatibility_version = u32(get_integer(bytes, 16, 4)),
		rules_version = u32(get_integer(bytes, 20, 4)),
		behavior_id = u32(get_integer(bytes, 24, 4)),
		coordinate_version = u32(get_integer(bytes, 28, 4)),
		rate = get_float(bytes, 48),
	}
	for &offset_ms, offset_index in identity.offsets {
		offset_ms = get_float(bytes, 56 + offset_index * 8)
	}
	copy(identity.raw_digest[:], bytes[88:120])
	copy(identity.prepared_digest[:], bytes[120:152])
	status = validate_identity(identity, expected)
	if status != .OK {
		return {}, status
	}
	previous_frame: core_types.Input_Snapshot
	for frame_index in 0 ..< int(frame_count) {
		frame_offset := HEADER_BYTES + frame_index * FRAME_BYTES
		frame := read_frame(bytes, frame_offset)
		status, _ = validate_frames([]core_types.Input_Snapshot{frame})
		if status != .OK {
			return {}, status
		}
		if frame_index > 0 &&
		   (frame.sequence <= previous_frame.sequence ||
				   frame.effective_time_ms < previous_frame.effective_time_ms) {
			return {}, .INVALID_ARGUMENT
		}
		for reserved_byte in bytes[frame_offset + 52:frame_offset + 64] {
			if reserved_byte != 0 {
				return {}, .INVALID_ARGUMENT
			}
		}
		previous_frame = frame
	}
	if frame_count > u64(len(output)) {
		return {}, .OUTPUT_REQUIRED
	}
	if core_types.buffers_overlap(
		raw_data(bytes),
		required_bytes,
		raw_data(output),
		frame_count * size_of(core_types.Input_Snapshot),
	) {
		return {}, .INVALID_ARGUMENT
	}
	for frame_index in 0 ..< int(frame_count) {
		output[frame_index] = read_frame(bytes, HEADER_BYTES + frame_index * FRAME_BYTES)
	}
	result := Decoded {
		identity = identity,
		frames = output[:int(frame_count)],
	}
	copy(result.final_digest[:], bytes[152:184])
	return result, .OK
}
