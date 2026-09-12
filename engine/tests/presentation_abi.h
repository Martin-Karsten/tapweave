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
