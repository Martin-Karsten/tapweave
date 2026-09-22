// Private room protocol. These values describe client reports, never judgements.
export const PROTOCOL_VERSION = 2;
export const CHAT_HISTORY_LIMIT = 100;
export interface Chat_Message {
  message_id: number;
  client_message_id: string;
  member_id: string;
  nickname: string;
  sent_ms: number;
  text: string;
}

export function canonical_chat_text(candidate: unknown): string {
  if (typeof candidate !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(candidate)) {
    throw new Error('Invalid chat text.');
  }
  const text = candidate.replace(/[\r\n\t\u2028\u2029]/g, ' ').trim();
  if (!text || [...text].length > 500 || new TextEncoder().encode(text).byteLength > 2000 || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) {
    throw new Error('Use 1–500 characters without control characters.');
  }
  return text;
}

export const RECONNECT_MS = 30_000;
export type Map_Availability = 'missing' | 'checking' | 'incompatible' | 'failed' | 'available';
export interface Selected_Map {
  map_hash: string;
  music_hash: string;
  engine_hash: string;
  title: string;
  artist: string;
  creator: string;
  difficulty: string;
  end_ms: number;
}

function valid_sha256(hash: unknown): hash is string {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
}

function valid_map_label(label: unknown): label is string {
  if (typeof label !== 'string' || label.length > 128) {
    return false;
  }
  return !/[\u0000-\u001f\u007f]/.test(label);
}

export function valid_selected_map(candidate: unknown): candidate is Selected_Map {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const descriptor = candidate as Selected_Map;
  const valid_hashes =
    valid_sha256(descriptor.map_hash) &&
    valid_sha256(descriptor.music_hash) &&
    valid_sha256(descriptor.engine_hash);
  const valid_labels =
    valid_map_label(descriptor.title) &&
    valid_map_label(descriptor.artist) &&
    valid_map_label(descriptor.creator) &&
    valid_map_label(descriptor.difficulty);
  const valid_timeline =
    Number.isFinite(descriptor.end_ms) &&
    descriptor.end_ms > 0 &&
    descriptor.end_ms < 4 * 60 * 60_000;
  return valid_hashes && valid_labels && valid_timeline;
}

export function matching_map(actual: Selected_Map, expected: Selected_Map): boolean {
  return (
    actual.map_hash === expected.map_hash &&
    actual.music_hash === expected.music_hash &&
    actual.engine_hash === expected.engine_hash &&
    actual.end_ms === expected.end_ms
  );
}

export interface Score_Report {
  score: number;
  accuracy: number;
  combo: number;
  progress: number;
}

export interface Terminal_Report extends Score_Report {
  status: 'completed' | 'failed' | 'withdrawn';
}

export interface Room_Member {
  member_id: string;
  nickname: string;
  ready: boolean;
  availability: Map_Availability;
  connected: boolean;
}

export interface Room_Round {
  selected_map: Selected_Map;
  selection_revision: number;
  round_id: string;
  start_ms: number;
  deadline_ms: number;
  participants: string[];
  results: Record<string, Terminal_Report>;
}

export interface Room_Snapshot {
  version: 2;
  type: 'snapshot';
  chat_version?: 1;
  sequence: number;
  room_id: string;
  member_id: string;
  host_id: string;
  phase: 'lobby' | 'countdown' | 'playing' | 'results';
  members: Room_Member[];
  round: Room_Round | null;
  engine_hash: string;
  selected_map: Selected_Map | null;
  selection_revision: number;
  expires_ms: number;
}

export type Client_Command =
  | { type: 'chat_subscribe' }
  | { type: 'chat_send'; client_message_id: string; text: string }
  | {
      type: 'clock';
      client_ms: number;
    }
  | {
      type: 'ready';
      ready: boolean;
      selection_revision: number;
    }
  | {
      type: 'select';
      selection_revision: number;
      selected_map: Selected_Map;
    }
  | {
      type: 'availability';
      selection_revision: number;
      availability: Map_Availability;
    }
  | {
      type: 'start';
      selection_revision: number;
    }
  | {
      type: 'rematch' | 'leave';
    }
  | {
      type: 'score';
      round_id: string;
      report: Score_Report;
    }
  | {
      type: 'terminal';
      round_id: string;
      report: Terminal_Report;
    };

// The browser assigns the protocol envelope when sending a command.
export type Client_Message = Client_Command & {
  version: 2;
  sequence: number;
};

export type Server_Message =
  | Room_Snapshot
  | { version: 2; type: 'chat_history'; messages: Chat_Message[]; high_water_id: number; final: boolean }
  | { version: 2; type: 'chat_message'; message: Chat_Message }
  | { version: 2; type: 'chat_error'; client_message_id: string | null; code: string; message: string; retry_after_ms?: number }
  | {
      version: 2;
      type: 'clock';
      sequence: number;
      client_ms: number;
      server_ms: number;
    }
  | {
      version: 2;
      type: 'score';
      member_id: string;
      round_id: string;
      sequence: number;
      report: Score_Report;
    }
  | {
      version: 2;
      type: 'error';
      code: string;
      message: string;
    };

export function valid_score(report: unknown): report is Score_Report {
  if (!report || typeof report !== 'object') {
    return false;
  }
  const candidate = report as Score_Report;
  return (
    Number.isSafeInteger(candidate.score) &&
    candidate.score >= 0 &&
    candidate.score <= 1_000_000_000 &&
    Number.isFinite(candidate.accuracy) &&
    candidate.accuracy >= 0 &&
    candidate.accuracy <= 1 &&
    Number.isInteger(candidate.combo) &&
    candidate.combo >= 0 &&
    candidate.combo <= 1_000_000 &&
    Number.isFinite(candidate.progress) &&
    candidate.progress >= 0 &&
    candidate.progress <= 1
  );
}

export function parse_client_message(raw: string): Client_Message {
  if (new TextEncoder().encode(raw).byteLength > 4096) {
    throw new Error('Message exceeds 4 KiB.');
  }
  const message = JSON.parse(raw);
  if (
    !message ||
    message.version !== PROTOCOL_VERSION ||
    !Number.isSafeInteger(message.sequence) ||
    message.sequence < 1
  ) {
    throw new Error('Invalid protocol or sequence.');
  }
  if (
    ['select', 'availability', 'ready', 'start'].includes(message.type) &&
    (!Number.isSafeInteger(message.selection_revision) || message.selection_revision < 0)
  ) {
    throw new Error('Invalid selection revision.');
  }
  switch (message.type) {
    case 'chat_subscribe':
      break;
    case 'chat_send':
      if (typeof message.client_message_id !== 'string' || !/^[a-f0-9]{32}$/.test(message.client_message_id)) {
        throw new Error('Invalid chat message identifier.');
      }
      message.text = canonical_chat_text(message.text);
      break;
    case 'select':
      if (
        !valid_selected_map(message.selected_map) ||
        Object.keys(message.selected_map).length !== 8
      ) {
        throw new Error('Invalid selected map descriptor.');
      }
      break;
    case 'availability':
      if (
        !['missing', 'checking', 'incompatible', 'failed', 'available'].includes(
          message.availability,
        )
      ) {
        throw new Error('Invalid map availability.');
      }
      break;
    case 'clock':
      if (!Number.isFinite(message.client_ms) || message.client_ms < 0) {
        throw new Error('Invalid clock sample.');
      }
      break;
    case 'ready':
      if (typeof message.ready !== 'boolean') {
        throw new Error('Invalid readiness.');
      }
      break;
    case 'start':
    case 'rematch':
    case 'leave':
      break;
    case 'score':
    case 'terminal':
      if (
        typeof message.round_id !== 'string' ||
        message.round_id.length > 64 ||
        !valid_score(message.report)
      ) {
        throw new Error('Invalid score report.');
      }
      if (
        message.type === 'terminal' &&
        !['completed', 'failed', 'withdrawn'].includes(message.report.status)
      ) {
        throw new Error('Invalid terminal state.');
      }
      // Persist only protocol fields, never arbitrary client properties.
      message.report = {
        score: message.report.score,
        accuracy: message.report.accuracy,
        combo: message.report.combo,
        progress: message.report.progress,
        ...(message.type === 'terminal' ? { status: message.report.status } : {}),
      };
      break;
    default:
      throw new Error('Unknown message type.');
  }
  const command_fields: Record<string, string[]> = {
    chat_subscribe: [],
    chat_send: ['client_message_id', 'text'],
    clock: ['client_ms'],
    select: ['selection_revision', 'selected_map'],
    availability: ['selection_revision', 'availability'],
    ready: ['selection_revision', 'ready'],
    start: ['selection_revision'],
    rematch: [],
    leave: [],
    score: ['round_id', 'report'],
    terminal: ['round_id', 'report'],
  };
  const allowed_fields = ['type', 'version', 'sequence', ...command_fields[message.type]];
  if (Object.keys(message).some((field) => !allowed_fields.includes(field))) {
    throw new Error('Unexpected protocol field.');
  }
  return message;
}

export function ranked_results(round: Room_Round) {
  const completed_results = Object.entries(round.results)
    .filter(([, report]) => report.status === 'completed')
    .sort((left, right) => right[1].score - left[1].score);
  return completed_results.map(([member_id, report]) => ({
    member_id,
    ...report,
    placement:
      completed_results.findIndex(([, other_report]) => other_report.score === report.score) + 1,
  }));
}
