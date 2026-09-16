// Deliberate verbatimModuleSyntax violation: value import used only as a type.
import { createSignal } from 'solid-js';
import { Song_Entry } from '../typecheck_fixtures/generic_select.js';

export type Song_Reference = { source: Song_Entry; copies: ReturnType<typeof createSignal> };
