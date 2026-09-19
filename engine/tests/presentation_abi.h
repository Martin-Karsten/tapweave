/* Native transport checks; no drawable/upstream acceptance is implied. */
static void presentation_native_probe(void) {
    unsigned char *mailbox = (unsigned char *)oe_abi_control();
    oe_handle *handle_output = (void *)(mailbox + OE_MAILBOX_RESULT);
    oe_byte_span *span_output = (void *)(mailbox + OE_MAILBOX_RESULT);
    oe_error_v1 *error_output = (void *)(mailbox + OE_MAILBOX_ERROR);
    oe_engine_create_v1 *engine_creation = (void *)mailbox;
    *engine_creation = (oe_engine_create_v1){.type = 1, .version = 1,
        .byte_size = sizeof(*engine_creation), .flags = 1};
    assert(oe_engine_create(engine_creation, handle_output, error_output) == 0);
    oe_handle engine_handle = *handle_output;
    oe_viewport_v1 *viewport = (void *)mailbox;
    *viewport = (oe_viewport_v1){.type = 29, .version = 1,
        .byte_size = sizeof(*viewport), .css_left = 13.5, .css_top = 29.25,
        .css_width = 1024, .css_height = 768, .device_pixel_ratio = 2};
    assert(oe_playfield_transform(engine_handle, (uintptr_t)viewport, (uintptr_t)span_output) == 0);
    oe_playfield_transform_v1 *transform = (void *)(uintptr_t)span_output->address;
    assert(span_output->count == sizeof(*transform));
    assert(transform->scale == 2 && transform->client_left == 13.5 && transform->client_top == 29.25);
    assert(transform->inverse_a == 0.5 && transform->inverse_d == 0.5);
    assert(transform->inverse_e == -6.75 && transform->inverse_f == -14.625);
    oe_playfield_transform_v1 previous_transform = *transform;
    oe_byte_span previous_span = *span_output;
    viewport->css_width = 0;
    assert(oe_playfield_transform(engine_handle, (uintptr_t)viewport, (uintptr_t)span_output) == 1);
    assert(memcmp(&previous_transform, transform, sizeof(*transform)) == 0);
    assert(memcmp(&previous_span, span_output, sizeof(*span_output)) == 0);
    viewport->css_width = 1024;
    assert(oe_playfield_transform(engine_handle, 1, (uintptr_t)span_output) == 1);
    assert(oe_playfield_transform(engine_handle, (uintptr_t)viewport, 1) == 1);
    viewport->version = 2;
    assert(oe_playfield_transform(engine_handle, (uintptr_t)viewport, (uintptr_t)span_output) == 3);
    assert(oe_engine_release(engine_handle) == 0);
    assert(oe_playfield_transform(engine_handle, (uintptr_t)viewport, (uintptr_t)span_output) != 0);
}

static uint32_t draw_native_probe(unsigned char *draw_bytes) {
    unsigned char *mailbox = (unsigned char *)oe_abi_control();
    oe_handle *handle_output = (void *)(mailbox + OE_MAILBOX_RESULT);
    oe_byte_span *span_output = (void *)(mailbox + OE_MAILBOX_RESULT);
    oe_error_v1 *error_output = (void *)(mailbox + OE_MAILBOX_ERROR);
    oe_engine_create_v1 *engine_creation = (void *)mailbox;
    *engine_creation = (oe_engine_create_v1){.type = 1, .version = 1,
        .byte_size = sizeof(*engine_creation), .flags = 1};
    assert(oe_engine_create(engine_creation, handle_output, error_output) == 0);
    oe_handle engine_handle = *handle_output;
    const char map_text[] = "osu file format v14\n[HitObjects]\n256,192,1000,1,0";
    assert(oe_buffer_reserve(engine_handle, 1, sizeof(map_text)-1, span_output) == 0);
    memcpy((void *)(uintptr_t)span_output->address, map_text, sizeof(map_text)-1);
    oe_map_prepare_v1 *map_creation = (void *)mailbox;
    *map_creation = (oe_map_prepare_v1){.type = 2, .version = 1, .byte_size = sizeof(*map_creation),
        .token = span_output->token, .count = sizeof(map_text)-1, .flags = 2};
    assert(oe_map_prepare(engine_handle, map_creation, handle_output, error_output) == 0);
    oe_handle map_handle = *handle_output;
    assert(oe_map_render_resources(engine_handle, map_handle, (uintptr_t)span_output) == 0);
    oe_gameplay_create_v1 *session_creation = (void *)mailbox;
    *session_creation = (oe_gameplay_create_v1){.type = 18, .version = 1, .byte_size = sizeof(*session_creation),
        .flags = 2, .arena_bytes = 65536, .input_capacity = 8};
    assert(oe_session_create(engine_handle, map_handle, (void *)session_creation, handle_output, error_output) == 0);
    oe_handle session_handle = *handle_output;
    oe_render_reserve_v1 *reserve = (void *)mailbox;
    *reserve = (oe_render_reserve_v1){.type = 36, .version = 1, .byte_size = sizeof(*reserve),
        .arena_bytes = 65536, .instance_capacity = 24};
    assert(oe_session_render_reserve(engine_handle, session_handle, (uintptr_t)reserve, (uintptr_t)span_output) == 0);
    const oe_render_capacity_v1 *capacity = (void *)(uintptr_t)span_output->address;
    assert(capacity->type == 37 && capacity->requested_instances == 24);
    oe_viewport_v1 *viewport = (void *)mailbox;
    *viewport = (oe_viewport_v1){.type = 29, .version = 1, .byte_size = sizeof(*viewport),
        .css_width = 512, .css_height = 384, .device_pixel_ratio = 1};
    assert(oe_session_draw(engine_handle, session_handle, 500, (uintptr_t)viewport, (uintptr_t)span_output) == 0);
    const oe_draw_frame_v1 *frame = (void *)(uintptr_t)span_output->address;
    assert(frame->type == 38 && frame->instances_count == 4 && frame->resource_id == map_handle);
    assert(frame->instances_stride == sizeof(oe_draw_instance_v1));
    uint32_t byte_count = frame->instances_count * frame->instances_stride;
    memcpy(draw_bytes, (unsigned char *)frame + frame->instances_offset, byte_count);
    assert(oe_engine_release(engine_handle) == 0);
    return byte_count;
}

static uint32_t scene_native_probe(unsigned char *draw_bytes, unsigned char *resource_bytes, uint32_t *resource_byte_count) {
    unsigned char *mailbox = (unsigned char *)oe_abi_control();
    oe_handle *handle_output = (void *)(mailbox + OE_MAILBOX_RESULT);
    oe_byte_span *span_output = (void *)(mailbox + OE_MAILBOX_RESULT);
    oe_error_v1 *error_output = (void *)(mailbox + OE_MAILBOX_ERROR);
    oe_engine_create_v1 *engine_creation = (void *)mailbox;
    *engine_creation = (oe_engine_create_v1){.type = 1, .version = 1,
        .byte_size = sizeof(*engine_creation), .flags = 1};
    assert(oe_engine_create(engine_creation, handle_output, error_output) == 0);
    oe_handle engine_handle = *handle_output;
    const char map_text[] = "osu file format v14\n[Difficulty]\nHPDrainRate:0\nCircleSize:4\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n[TimingPoints]\n0,500,4,1,1,100,1,0\n[HitObjects]\n100,100,1000,1,0\n150,180,1500,2,0,L|380:180|150:180,2,460\n256,192,5500,8,0,7000\n";
    assert(oe_buffer_reserve(engine_handle, 1, sizeof(map_text)-1, span_output) == 0);
    memcpy((void *)(uintptr_t)span_output->address, map_text, sizeof(map_text)-1);
    oe_map_prepare_v1 *map_creation = (void *)mailbox;
    *map_creation = (oe_map_prepare_v1){.type = 2, .version = 1, .byte_size = sizeof(*map_creation),
        .token = span_output->token, .count = sizeof(map_text)-1, .flags = 2};
    assert(oe_map_prepare(engine_handle, map_creation, handle_output, error_output) == 0);
    oe_handle map_handle = *handle_output;
    assert(oe_map_scene_resources(engine_handle, map_handle, (uintptr_t)span_output) == 0);
    *resource_byte_count = span_output->count;
    assert(*resource_byte_count < 1048576);
    memcpy(resource_bytes, (void *)(uintptr_t)span_output->address, *resource_byte_count);
    ((oe_scene_resource_v1 *)resource_bytes)->resource_id = 0; // Handles are process-local.

    oe_gameplay_create_v1 *session_creation = (void *)mailbox;
    *session_creation = (oe_gameplay_create_v1){.type = 18, .version = 1, .byte_size = sizeof(*session_creation),
        .flags = 2, .arena_bytes = 4 * 1024 * 1024, .input_capacity = 32};
    assert(oe_session_create(engine_handle, map_handle, (void *)session_creation, handle_output, error_output) == 0);
    oe_handle session_handle = *handle_output;
    oe_scene_reserve_v1 *reserve = (void *)mailbox;
    *reserve = (oe_scene_reserve_v1){.type = 48, .version = 1, .byte_size = sizeof(*reserve),
        .arena_bytes = 4 * 1024 * 1024, .instance_capacity = 4096};
    assert(oe_session_scene_reserve(engine_handle, session_handle, (uintptr_t)reserve, (uintptr_t)span_output) == 0);
    const oe_render_capacity_v1 *capacity = (void *)(uintptr_t)span_output->address;
    assert(capacity->type == 37 && capacity->requested_instances == 4096);
    oe_viewport_v1 *viewport = (void *)mailbox;
    *viewport = (oe_viewport_v1){.type = 29, .version = 1, .byte_size = sizeof(*viewport),
        .css_width = 512, .css_height = 384, .device_pixel_ratio = 1};
    assert(oe_session_scene_draw(engine_handle, session_handle, 1400, (uintptr_t)viewport, (uintptr_t)span_output) == 0);
    const oe_scene_frame_v1 *frame = (void *)(uintptr_t)span_output->address;
    assert(frame->type == 47 && frame->instances_count > 4 && frame->resource_id == map_handle);
    assert(frame->instances_stride == sizeof(oe_scene_instance_v1));
    uint32_t byte_count = frame->instances_count * frame->instances_stride;
    memcpy(draw_bytes, (unsigned char *)frame + frame->instances_offset, byte_count);
    assert(oe_engine_release(engine_handle) == 0);
    return byte_count;
}
