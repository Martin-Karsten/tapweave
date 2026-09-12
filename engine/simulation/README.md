# Independent simulation queues

These internal, allocation-free primitives borrow caller-owned storage. They do
not implement a complete session scheduler or expose production gameplay ABI.
Initialize queues with zeroed state and a storage slice; mutate queue state only
through the queue procedures while that storage remains valid.

`enqueue_inputs` requires its input slice to be disjoint from the entire ring
storage. `drain` likewise requires its output slice to be disjoint from the entire
event-heap storage. Exact and partial overlap return `INVALID_ARGUMENT` before
changing queue state or buffer contents. Empty slices do not overlap; adjacent
slices are permitted. Use separate caller buffers for submission and draining.

Input batches are validated completely before publication. Consumed ring slots
are reused, while the last accepted sequence/time remain the admission boundary.
Future records stay queued. Event drains pop only complete events that fit;
`OUTPUT_REQUIRED` retains the remaining events for a retry. The session must
dispatch all events through its target before committing that target time.

## Integrated sessions

`session.odin` consumes immutable prepared maps and owns no browser resources.
Its mutable slices borrow the runtime-owned creation arena; sessions must not be
copied. See the [M2 session report](../../docs/implementation/m2-sessions.md) for
production APIs, event/recording policy, tests and remaining acceptance gates.
